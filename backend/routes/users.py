"""
User preference routes.

PATCH /users/preferences , set locations, role, job types, skills, constraints
GET   /users/preferences , get current preferences
"""

"""
Skill override routes, candidate knowledge memory system.

POST /users/skill-overrides       , add or update a skill override
GET  /users/skill-overrides       , list all overrides
DELETE /users/skill-overrides/{skill}, remove a specific override

Also adds about_me to UserPreferences.
"""
from datetime import datetime, timedelta, timezone
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from config import settings
from core.rate_limit import enforce_rate_limit
from core.security import verify_password
from database import get_database
from deps import get_current_user
from models.user import DeleteAccountRequest
from services.cv_parser import flatten_skills
from services.email import send_model_request_admin_email, smtp_configured
from services.limits import get_user_usage
from services.ai_models import PURPOSE_USER_FIELDS, PURPOSES, get_model, list_models
from services.calibration import (
    MIN_FEEDBACK_FOR_CALIBRATION,
    regenerate_calibration_notes,
)
from services.text_cleanup import clean_candidate_text
from routes.crawler import get_apply_soon_count, get_stale_followup_jobs

router = APIRouter(prefix="/users", tags=["users"])


class JobTypes(BaseModel):
    full_time: bool = True
    internship: bool = False
    contract: bool = False
    remote: bool = True
    graduate: bool = False


class WorkMode(BaseModel):
    remote: bool = True
    hybrid: bool = True
    onsite: bool = False


class UserPreferences(BaseModel):
    preferred_locations: list[str] = []
    primary_role: str = ""
    secondary_roles: list[str] = []
    job_types: JobTypes = JobTypes()
    min_salary: int = 0
    use_salary_in_rating: bool = False  # opt-in: rating may weigh min_salary
    key_skills: list[str] = []
    experience_level: str = "mid"
    nationality: str = ""
    visa_status: str = ""
    work_authorization: str = ""
    visa_country: str = ""  # country the held visa/permit is valid in, e.g. "Germany"
    visa_type: str = ""  # e.g. "EU Blue Card", "H-1B", "Stamp 1G"
    avoid_industries: list[str] = []
    work_mode: WorkMode = WorkMode()
    about_me: str = ""  # user's own notes, never overwritten by CV parse
    about_me_from_cv: str = ""  # CV summary, refreshed on each upload
    showcase_projects: list[
        str
    ] = []  # flagship work to lead tailored CVs, any user's list
    email_reminders_enabled: bool = True  # daily high-score apply nudges via SMTP
    reminder_hours: list[
        int
    ] = []  # local hours (0-23) to send reminders; [] = app default (see job_reminders.py)
    timezone: str = ""  # IANA tz; empty = UTC until they pick one in Settings
    # "" = app default. Otherwise must match an active entry in the
    # admin-managed AI model catalog (services/ai_models.py), validated in
    # update_preferences below, not via a fixed Literal, since admin can
    # add/remove models without a code change.
    rating_provider: str = ""
    rating_model: str = ""
    apply_pack_provider: str = ""
    apply_pack_model: str = ""
    # Same idea, for the model that parses an uploaded CV into structured JSON.
    cv_parsing_provider: str = ""
    cv_parsing_model: str = ""
    # CV PDF look: classic | compact | technical (+ optional section toggles/order).
    cv_template_preset: str = "classic"
    cv_sections: dict = {}
    # Company career boards: URLs or "greenhouse:stripe" / "ashby:openai" / "lever:slug".
    ats_boards: list[str] = []


class SkillOverride(BaseModel):
    skill: str  # key e.g. "plotly"
    context: str  # candidate's description e.g. "used in BEng for ML visualisation"


def _normalize_cv_preset(value: str | None) -> str:
    p = (value or "classic").strip().lower()
    return p if p in ("classic", "compact", "technical") else "classic"


# ── Preferences ───────────────────────────────────────────────────────────────


@router.patch("/preferences")
async def update_preferences(payload: UserPreferences, user=Depends(get_current_user)):
    db = get_database()
    prefs = payload.model_dump()

    # Only re-run the LLM cleanup when about_me actually changed, this
    # endpoint saves EVERY preference (including a bare rating-model switch),
    # and re-cleaning unchanged text on every save made unrelated saves (e.g.
    # picking a new rating model) wait on a full LLM round-trip for nothing.
    if prefs["about_me"].strip() and prefs["about_me"] != user.get("about_me", ""):
        prefs["about_me"] = await clean_candidate_text(
            prefs["about_me"], "candidate career summary", user_id=str(user["_id"])
        )

    async def _validate_model_choice(provider_key: str, model_key: str, purpose: str):
        if prefs[provider_key]:
            catalog_entry = await get_model(
                prefs[provider_key], prefs[model_key], purpose
            )
            if not catalog_entry or not catalog_entry["active"]:
                raise HTTPException(
                    status_code=400,
                    detail="Unknown or inactive model. Refresh Settings and try again.",
                )
        else:
            prefs[model_key] = ""

    await _validate_model_choice("rating_provider", "rating_model", "rating")
    await _validate_model_choice(
        "apply_pack_provider", "apply_pack_model", "apply_pack"
    )
    await _validate_model_choice(
        "cv_parsing_provider", "cv_parsing_model", "cv_parsing"
    )

    reminder_hours = sorted({h for h in prefs["reminder_hours"] if 0 <= h <= 23})

    updates = {
        "preferred_locations": prefs["preferred_locations"],
        "primary_role": prefs["primary_role"],
        "secondary_roles": prefs["secondary_roles"],
        "job_types": prefs["job_types"],
        "min_salary": prefs["min_salary"],
        "use_salary_in_rating": prefs["use_salary_in_rating"],
        "key_skills": prefs["key_skills"],
        "experience_level": prefs["experience_level"],
        "nationality": prefs["nationality"],
        "visa_status": prefs["visa_status"],
        "work_authorization": prefs["work_authorization"],
        "avoid_industries": prefs["avoid_industries"],
        "work_mode": prefs["work_mode"],
        "about_me": prefs["about_me"],
        "about_me_from_cv": prefs.get("about_me_from_cv", ""),
        "showcase_projects": [
            p.strip() for p in (prefs.get("showcase_projects") or []) if str(p).strip()
        ][:12],
        "email_reminders_enabled": prefs["email_reminders_enabled"],
        "reminder_hours": reminder_hours,
        "timezone": prefs["timezone"],
        "rating_provider": prefs["rating_provider"],
        "rating_model": prefs["rating_model"],
        "apply_pack_provider": prefs["apply_pack_provider"],
        "apply_pack_model": prefs["apply_pack_model"],
        "cv_parsing_provider": prefs["cv_parsing_provider"],
        "cv_parsing_model": prefs["cv_parsing_model"],
        "cv_template_preset": _normalize_cv_preset(prefs.get("cv_template_preset")),
        "cv_sections": prefs.get("cv_sections") or {},
        "ats_boards": [
            s.strip()
            for s in (prefs.get("ats_boards") or [])
            if isinstance(s, str) and s.strip()
        ][:40],
    }
    # Switching provider sends the user's CV/job data to a different company,
    # record when they last consented to that (surfaced as a confirm popup in
    # Settings before this request is even sent). Picking a different model
    # within the SAME provider doesn't need re-consent, and this also clears
    # any earlier admin-granted override automatically, the self-service
    # "revert off an admin override" path, no special case.
    if prefs["rating_provider"] != user.get("rating_provider", ""):
        updates["rating_provider_consent_at"] = datetime.now(timezone.utc)
    if prefs["apply_pack_provider"] != user.get("apply_pack_provider", ""):
        updates["apply_pack_provider_consent_at"] = datetime.now(timezone.utc)
    if prefs["cv_parsing_provider"] != user.get("cv_parsing_provider", ""):
        updates["cv_parsing_provider_consent_at"] = datetime.now(timezone.utc)

    await db.users.update_one({"_id": ObjectId(user["_id"])}, {"$set": updates})
    return {"message": "Preferences updated.", "preferences": prefs}


@router.get("/faq")
async def get_faq(q: str = "", user=Depends(get_current_user)):
    """Product FAQ list, or RAG-ranked answers when ?q= is set.

    FAQ answers are canned corpus text (no LLM / no token burn).
    """
    from services.faq_rag import (
        answer_from_faq,
        list_faq,
        retrieve_faq,
        sanitize_faq_query,
    )

    q = sanitize_faq_query(q)
    if q:
        ans = answer_from_faq(q)
        hits = retrieve_faq(q, k=5)
        return {
            "query": q,
            "answer": ans,
            "hits": [
                {"id": h["id"], "question": h["question"], "answer": h["answer"]}
                for h in hits
            ],
            "items": list_faq(),
            "model": "none",
            "note": "FAQ uses curated RAG answers only - no chat model.",
        }
    return {"items": list_faq(), "model": "none"}


@router.get("/preferences")
async def get_preferences(user=Depends(get_current_user)):
    return {
        "preferred_locations": user.get("preferred_locations", []),
        "primary_role": user.get("primary_role", ""),
        "secondary_roles": user.get("secondary_roles", []),
        "job_types": user.get("job_types", {}),
        "min_salary": user.get("min_salary", 0),
        "use_salary_in_rating": bool(user.get("use_salary_in_rating", False)),
        "key_skills": user.get("key_skills", []),
        "experience_level": user.get("experience_level", "mid"),
        "nationality": user.get("nationality", ""),
        "visa_status": user.get("visa_status", ""),
        "work_authorization": user.get("work_authorization", ""),
        "avoid_industries": user.get("avoid_industries", []),
        "work_mode": user.get(
            "work_mode", {"remote": True, "hybrid": True, "onsite": False}
        ),
        "about_me": user.get("about_me", ""),
        "about_me_from_cv": user.get("about_me_from_cv", ""),
        "showcase_projects": user.get("showcase_projects", []),
        "email_reminders_enabled": user.get("email_reminders_enabled", True),
        "reminder_hours": user.get("reminder_hours", []),
        "timezone": user.get("timezone", ""),
        "rating_provider": user.get("rating_provider", ""),
        "rating_model": user.get("rating_model", ""),
        "rating_model_request": user.get("rating_model_request"),
        "apply_pack_provider": user.get("apply_pack_provider", ""),
        "apply_pack_model": user.get("apply_pack_model", ""),
        "apply_pack_model_request": user.get("apply_pack_model_request"),
        "cv_parsing_provider": user.get("cv_parsing_provider", ""),
        "cv_parsing_model": user.get("cv_parsing_model", ""),
        "cv_parsing_model_request": user.get("cv_parsing_model_request"),
        "calibration_notes": user.get("calibration_notes", ""),
        "calibration_notes_updated_at": user.get("calibration_notes_updated_at"),
        "calibration_notes_source_count": user.get("calibration_notes_source_count", 0),
        "cv_template_preset": user.get("cv_template_preset", "classic") or "classic",
        "cv_sections": user.get("cv_sections") or {},
        "ats_boards": user.get("ats_boards") or [],
    }


@router.post("/calibration-notes/regenerate")
async def regenerate_calibration_notes_now(user=Depends(get_current_user)):
    """Manual "refresh now", re-summarizes ALL of the user's existing
    rating-feedback history immediately, instead of waiting for their next
    feedback submission to trigger it (see services/calibration.py)."""
    notes = await regenerate_calibration_notes(str(user["_id"]))
    if notes is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Not enough feedback yet, leave at least "
                f"{MIN_FEEDBACK_FOR_CALIBRATION} ratings feedback comments/stars first."
            ),
        )
    return {"calibration_notes": notes}


@router.get("/ai-models")
async def get_available_ai_models(
    purpose: Literal["rating", "apply_pack", "cv_parsing"] = "rating",
    user=Depends(get_current_user),
):
    """Active catalog entries for a Settings picker (admin-managed, see
    routes/admin.py ai-models CRUD)."""
    return {"models": await list_models(purpose, active_only=True)}


@router.get("/cv-latex-template")
async def get_cv_latex_template(user=Depends(get_current_user)):
    return {
        "has_custom": bool((user.get("cv_latex_template") or "").strip()),
        "name": user.get("cv_latex_template_name") or "",
        "updated_at": user.get("cv_latex_template_updated_at"),
        # Do not echo full tex in list views; client fetches sample separately.
        "preview": (
            ((user.get("cv_latex_template") or "")[:400] + "…")
            if (user.get("cv_latex_template") or "").strip()
            else ""
        ),
    }


@router.get("/cv-latex-template/sample")
async def download_sample_cv_latex(user=Depends(get_current_user)):
    from pathlib import Path
    from fastapi.responses import PlainTextResponse

    path = (
        Path(__file__).resolve().parent.parent / "data" / "cv_templates" / "sample.tex"
    )
    if not path.exists():
        raise HTTPException(status_code=404, detail="Sample template missing.")
    return PlainTextResponse(
        path.read_text(encoding="utf-8"),
        media_type="application/x-tex",
        headers={
            "Content-Disposition": 'attachment; filename="jobradar-sample-cv.tex"'
        },
    )


@router.put("/cv-latex-template")
async def put_cv_latex_template(
    request: Request,
    user=Depends(get_current_user),
):
    """Upload or paste a custom .tex template. Validated against shell-escape."""
    from services.latex_template_safe import sanitize_and_validate_latex

    enforce_rate_limit(request, "cv_upload")
    content_type = (request.headers.get("content-type") or "").lower()
    name = "custom.tex"
    raw: bytes | str
    if "multipart/form-data" in content_type:
        form = await request.form()
        upload = form.get("file")
        if upload is None:
            raise HTTPException(status_code=400, detail="file is required.")
        raw = await upload.read()  # type: ignore[attr-defined]
        name = getattr(upload, "filename", None) or name
    else:
        body = await request.json()
        raw = body.get("tex") or ""
        name = (body.get("name") or name).strip() or name

    try:
        tex = sanitize_and_validate_latex(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not name.lower().endswith(".tex"):
        name = f"{name}.tex"
    # Strip path tricks from filename
    name = name.replace("\\", "/").split("/")[-1][:120]

    db = get_database()
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "cv_latex_template": tex,
                "cv_latex_template_name": name,
                "cv_latex_template_updated_at": now,
            }
        },
    )
    return {"ok": True, "name": name}


@router.delete("/cv-latex-template")
async def delete_cv_latex_template(user=Depends(get_current_user)):
    db = get_database()
    await db.users.update_one(
        {"_id": user["_id"]},
        {
            "$unset": {
                "cv_latex_template": "",
                "cv_latex_template_name": "",
                "cv_latex_template_updated_at": "",
            }
        },
    )
    return {"ok": True}


def _clean_text(s: str | None, n: int, *, allow_newlines: bool = False) -> str:
    """Strip control chars / injection noise from free text, cap length."""
    allowed = "\n\t" if allow_newlines else " "
    return "".join(ch for ch in (s or "").strip() if ch in allowed or ord(ch) >= 32)[:n]


async def _patch_cv_structured(user: dict, mutate) -> dict:
    """Fetch this user's fresh cv.structured, apply `mutate(structured)` in
    place, persist, and return the mutated dict. `mutate` may raise
    HTTPException (e.g. a dedupe conflict) before anything is written."""
    db = get_database()
    fresh = await db.users.find_one({"_id": user["_id"]})
    cv = (fresh or {}).get("cv") or {}
    structured = dict(cv.get("structured") or {})
    mutate(structured)
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"cv.structured": structured}},
    )
    return structured


class MasterCvProjectPatch(BaseModel):
    name: str
    description: str = ""
    technologies: list[str] = []


@router.post("/cv/projects")
async def add_master_cv_project(
    payload: MasterCvProjectPatch,
    request: Request,
    user=Depends(get_current_user),
):
    """Append a confirmed project to MASTER CV structured data (chat Accept)."""
    enforce_rate_limit(request, "cv_upload")
    name = _clean_text(payload.name, 200)
    description = _clean_text(payload.description, 2000, allow_newlines=True)
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required.")
    techs = [
        _clean_text(t, 60) for t in (payload.technologies or [])[:20] if str(t).strip()
    ]

    def mutate(structured: dict) -> None:
        projects = list(structured.get("projects") or [])
        if any((p.get("name") or "").strip().lower() == name.lower() for p in projects):
            raise HTTPException(
                status_code=400, detail="That project is already on your MASTER CV."
            )
        projects.append(
            {
                "name": name,
                "description": description,
                "technologies": techs,
                "added_via": "chat_confirm",
            }
        )
        structured["projects"] = projects

    structured = await _patch_cv_structured(user, mutate)
    return {"ok": True, "projects_count": len(structured["projects"])}


class MasterCvExperiencePatch(BaseModel):
    title: str
    company: str = ""
    start: str = ""
    end: str = ""
    bullets: list[str] = []


@router.post("/cv/experience")
async def add_master_cv_experience(
    payload: MasterCvExperiencePatch,
    request: Request,
    user=Depends(get_current_user),
):
    """Append a confirmed role to MASTER CV structured data (chat Accept)."""
    enforce_rate_limit(request, "cv_upload")
    title = _clean_text(payload.title, 200)
    company = _clean_text(payload.company, 200)
    start = _clean_text(payload.start, 40)
    end = _clean_text(payload.end, 40)
    if not title:
        raise HTTPException(status_code=400, detail="Role title is required.")
    bullets = [
        _clean_text(b, 300) for b in (payload.bullets or [])[:20] if str(b).strip()
    ]

    def mutate(structured: dict) -> None:
        experience = list(structured.get("experience") or [])
        if any(
            (e.get("title") or "").strip().lower() == title.lower()
            and (e.get("company") or "").strip().lower() == company.lower()
            for e in experience
        ):
            raise HTTPException(
                status_code=400, detail="That role is already on your MASTER CV."
            )
        experience.append(
            {
                "title": title,
                "company": company,
                "start": start,
                "end": end,
                "bullets": bullets,
                "added_via": "chat_confirm",
            }
        )
        structured["experience"] = experience

    structured = await _patch_cv_structured(user, mutate)
    return {"ok": True, "experience_count": len(structured["experience"])}


class MasterCvSkillPatch(BaseModel):
    category: str = "Other"
    items: list[str] = []


@router.post("/cv/skills")
async def add_master_cv_skills(
    payload: MasterCvSkillPatch,
    request: Request,
    user=Depends(get_current_user),
):
    """Merge confirmed skills into MASTER CV structured data (chat Accept)."""
    enforce_rate_limit(request, "cv_upload")
    category = _clean_text(payload.category or "Other", 60) or "Other"
    items = [_clean_text(s, 60) for s in (payload.items or [])[:20] if str(s).strip()]
    if not items:
        raise HTTPException(status_code=400, detail="At least one skill is required.")

    def mutate(structured: dict) -> None:
        skills = list(structured.get("skills") or [])
        group = next(
            (
                g
                for g in skills
                if isinstance(g, dict)
                and (g.get("category") or "").strip().lower() == category.lower()
            ),
            None,
        )
        if group is None:
            skills.append({"category": category, "items": items})
        else:
            existing = {i.strip().lower() for i in (group.get("items") or [])}
            group["items"] = list(group.get("items") or []) + [
                i for i in items if i.strip().lower() not in existing
            ]
        structured["skills"] = skills

    structured = await _patch_cv_structured(user, mutate)
    return {"ok": True, "skills_count": len(flatten_skills(structured["skills"]))}


class ModelRequest(BaseModel):
    requested_model: str
    note: str = ""
    purpose: Literal["rating", "apply_pack", "cv_parsing"] = "rating"


@router.post("/rating-model-request")
async def request_model(payload: ModelRequest, user=Depends(get_current_user)):
    """User asks for a model outside the self-service catalog, for either
    purpose. Admin sees it as a badge in the admin panel and grants it via
    the matching override route, this just records the ask and best-effort
    pings the admin."""
    requested_model = payload.requested_model.strip()
    if not requested_model:
        raise HTTPException(status_code=400, detail="requested_model is required.")

    field = PURPOSE_USER_FIELDS[payload.purpose][2]
    db = get_database()
    now = datetime.now(timezone.utc)
    await db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {
            "$set": {
                field: {
                    "model": requested_model,
                    "note": payload.note.strip(),
                    "requested_at": now,
                }
            }
        },
    )

    if settings.admin_email and smtp_configured():
        try:
            send_model_request_admin_email(
                to_email=settings.admin_email,
                user_email=user.get("email", ""),
                requested_model=requested_model,
                note=payload.note.strip(),
                purpose=payload.purpose,
            )
        except Exception as e:
            print(f"[users] Failed to email admin about model request: {e}")

    return {"message": "Request sent.", "requested_model": requested_model}


# ── Notifications ─────────────────────────────────────────────────────────────
# Small bell/badge, not a full history, computed live from signals that
# already exist (apply-soon/stale-followup job counts, admin model catalog
# entries) rather than a separate stored notification log.


# A job's rated_at/status_at timestamp is set once and never moves again, so comparing
# it against notifications_last_seen_at alone means a still-true condition (an unapplied
# 8+ job, a stale follow-up) can only ever light the badge ONCE, opening the bell one
# time permanently kills it even though nothing was actually resolved. This re-arms the
# badge for still-true, still-actionable conditions after a few days of silence, "new
# model" alerts are a one-time event and deliberately excluded, they have nothing to re-nag about.
NOTIFICATIONS_REMIND_AFTER_DAYS = 3


@router.get("/notifications")
async def get_notifications(user=Depends(get_current_user)):
    db = get_database()
    user_id = str(user["_id"])
    last_seen = user.get("notifications_last_seen_at")
    if isinstance(last_seen, datetime) and last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    remind_stale = last_seen is not None and (
        datetime.now(timezone.utc) - last_seen
        > timedelta(days=NOTIFICATIONS_REMIND_AFTER_DAYS)
    )

    notifications = []
    unseen_count = 0
    dismissed: dict = {
        k: (v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v)
        for k, v in user.get("dismissed_notifications", {}).items()
    }

    # The dropdown always lists every currently-live item (still actionable,
    # e.g. "3 top matches ready to apply to" stays useful even if you've
    # already seen it). The badge counts what's new since last_seen, OR,
    # if it's been a few days of silence, still-unresolved items too.
    # A dismissed item stays hidden unless it's genuinely re-armed (a new
    # qualifying job/model since the dismiss), see notifications/dismiss.
    apply_soon_dismissed_at = dismissed.get("apply_soon")
    apply_soon_count = await get_apply_soon_count(db, user_id)
    apply_soon_new_since_dismiss = (
        await get_apply_soon_count(db, user_id, since=apply_soon_dismissed_at)
        if apply_soon_dismissed_at
        else apply_soon_count
    )
    if apply_soon_count > 0 and (
        not apply_soon_dismissed_at or apply_soon_new_since_dismiss > 0
    ):
        notifications.append(
            {
                "kind": "apply_soon",
                "key": "apply_soon",
                "message": (
                    f"{apply_soon_count} top match"
                    f"{'es' if apply_soon_count != 1 else ''} scoring 8+/10 ready to apply to"
                ),
                "link": "/",
            }
        )
        apply_soon_new = (
            await get_apply_soon_count(db, user_id, since=last_seen)
            if last_seen
            else apply_soon_count
        )
        if apply_soon_new > 0 or remind_stale:
            unseen_count += 1

    # Named per-job entries, not a bare count, "1 job needs a follow-up" gives
    # nothing to act on. Capped at 5 so a long-neglected pipeline doesn't flood
    # the dropdown; the rest still show up once these are cleared in Kanban.
    # A job dropping out of this query on its own (status change moves
    # status_at forward) is what re-arms a dismissed entry, so dismiss here
    # can suppress unconditionally: no dismissed job stays in this list
    # unless it went stale again.
    stale_jobs = await get_stale_followup_jobs(
        db, user_id, limit=5, last_seen=last_seen
    )
    for job in stale_jobs:
        key = f"stale_followup:{job['id']}"
        if key in dismissed:
            continue
        status_label = job["status"].replace("_", " ").title()
        notifications.append(
            {
                "kind": "stale_followup",
                "key": key,
                "message": (
                    f"{job['title']}"
                    + (f" at {job['company']}" if job["company"] else "")
                    + f", {status_label} {job['days_stale']}d ago with no update. "
                    "Probably a silent rejection, or worth a follow-up."
                ),
                "link": "/kanban",
            }
        )
        if job["newly_stale"] or remind_stale:
            unseen_count += 1

    # Only compare against a baseline once one exists, otherwise every model
    # ever added would show up as "new" on a user's very first bell check.
    if last_seen:
        purpose_labels = {
            "rating": "job rating",
            "apply_pack": "apply pack / tailored CV",
            "cv_parsing": "CV parsing",
        }
        for purpose in PURPOSES:
            key = f"new_model:{purpose}"
            model_dismissed_at = dismissed.get(key)
            new_model_count = await db.rating_models.count_documents(
                {"purpose": purpose, "active": True, "created_at": {"$gt": last_seen}}
            )
            if new_model_count > 0 and model_dismissed_at:
                new_since_dismiss = await db.rating_models.count_documents(
                    {
                        "purpose": purpose,
                        "active": True,
                        "created_at": {"$gt": model_dismissed_at},
                    }
                )
                if new_since_dismiss == 0:
                    continue
            if new_model_count > 0:
                label = purpose_labels[purpose]
                notifications.append(
                    {
                        "kind": "new_model",
                        "key": key,
                        "message": (
                            f"{new_model_count} new AI model"
                            f"{'s' if new_model_count != 1 else ''} available for {label}"
                        ),
                        "link": "/settings",
                    }
                )
                unseen_count += 1

    return {"notifications": notifications, "unseen_count": unseen_count}


@router.post("/notifications/dismiss")
async def dismiss_notification(payload: dict, user=Depends(get_current_user)):
    key = payload.get("key")
    if not key:
        raise HTTPException(status_code=400, detail="key is required")
    db = get_database()
    now = datetime.now(timezone.utc)
    dismissed: dict = {
        k: (v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v)
        for k, v in user.get("dismissed_notifications", {}).items()
    }
    # Self-pruning: no separate cleanup job needed for this volume.
    dismissed = {k: v for k, v in dismissed.items() if (now - v) < timedelta(days=30)}
    dismissed[key] = now
    await db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {"$set": {"dismissed_notifications": dismissed}},
    )
    return {"message": "Dismissed."}


@router.post("/notifications/seen")
async def mark_notifications_seen(user=Depends(get_current_user)):
    db = get_database()
    await db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {"$set": {"notifications_last_seen_at": datetime.now(timezone.utc)}},
    )
    return {"message": "Marked as seen."}


# ── Skill overrides ───────────────────────────────────────────────────────────


@router.post("/skill-overrides")
async def add_skill_override(payload: SkillOverride, user=Depends(get_current_user)):
    db = get_database()
    skill_key = payload.skill.lower().strip()

    await db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {"$set": {f"skill_overrides.{skill_key}": payload.context}},
    )
    return {
        "message": f"Override saved for '{skill_key}'.",
        "skill": skill_key,
        "context": payload.context,
    }


@router.get("/skill-overrides")
async def get_skill_overrides(user=Depends(get_current_user)):
    overrides = user.get("skill_overrides", {})
    return {"overrides": [{"skill": k, "context": v} for k, v in overrides.items()]}


@router.delete("/skill-overrides/{skill}")
async def delete_skill_override(skill: str, user=Depends(get_current_user)):
    db = get_database()
    skill_key = skill.lower().strip()

    await db.users.update_one(
        {"_id": ObjectId(user["_id"])}, {"$unset": {f"skill_overrides.{skill_key}": ""}}
    )
    return {"message": f"Override removed for '{skill_key}'."}


# ── Data transparency & deletion ─────────────────────────────────────────────


@router.get("/data-summary")
async def get_data_summary(user=Depends(get_current_user)):
    """Tell the user exactly what JobRadar stores about them."""
    db = get_database()
    user_id = str(user["_id"])
    cv = user.get("cv")
    overrides = user.get("skill_overrides", {})

    jobs_total = await db.jobs.count_documents({"crawled_by": user_id})
    jobs_rated = await db.jobs.count_documents(
        {"crawled_by": user_id, f"ratings.{user_id}": {"$exists": True}}
    )
    jobs_manual = await db.jobs.count_documents(
        {"crawled_by": user_id, "source": "manual"}
    )
    jobs_hidden = await db.jobs.count_documents(
        {f"hidden_{user_id}": True, "crawled_by": user_id}
    )

    usage = await get_user_usage(user_id)

    cv_summary = None
    if cv:
        structured = cv.get("structured", {})
        cv_summary = {
            "filename": cv.get("filename"),
            "uploaded_at": cv.get("uploaded_at"),
            "skills_count": len(flatten_skills(structured.get("skills", []))),
            "experience_count": len(structured.get("experience", [])),
            "projects_count": len(structured.get("projects", [])),
            "education_count": len(structured.get("education", [])),
            "has_raw_text": bool(cv.get("raw_text")),
        }

    return {
        "roast": (
            "We're not Google. We're also not your lawyer. But we ARE keeping your CV, "
            "job prefs, and every listing you've crawled in a database like it's a "
            "Pokémon card collection. Here's the inventory."
        ),
        "legal_note": (
            "JobRadar is a personal job-search tool. Listings come from third-party APIs "
            "(Jooble, Indeed/JobsAPI, etc.), each has its own terms. Your CV and "
            "preferences may be sent to an AI provider for job matching. This is not "
            "legal advice; for a public product you'd want a proper Privacy Policy. "
            "You can download or delete your data below anytime."
        ),
        "account": {
            "name": user.get("name"),
            "email": user.get("email"),
            "created_at": user.get("created_at"),
        },
        "cv": cv_summary,
        "preferences": {
            "has_preferences": bool(user.get("primary_role")),
            "locations_count": len(user.get("preferred_locations", [])),
            "skills_count": len(user.get("key_skills", [])),
            "about_me_chars": len(user.get("about_me", "") or ""),
            "has_work_authorization": bool(user.get("work_authorization")),
        },
        "skill_overrides_count": len(overrides),
        "jobs": {
            "total": jobs_total,
            "rated": jobs_rated,
            "manual": jobs_manual,
            "hidden": jobs_hidden,
        },
        "usage": {
            "searches_used": usage.get("searches_used", 0),
            "ratings_used": usage.get("ratings_used", 0),
        },
        "third_party_services": [
            "Jooble API, job listings",
            "JobsAPI (Indeed), job listings",
            "AI/LLM provider, CV + job description matching",
            "MongoDB, data storage",
        ],
        "stored_items": [
            {
                "key": "account",
                "label": "Account (name, email, password hash)",
                "stored": True,
            },
            {
                "key": "cv",
                "label": "CV, parsed PDF text & structured profile",
                "stored": bool(cv),
            },
            {
                "key": "preferences",
                "label": "Job preferences (roles, locations, salary, about you)",
                "stored": bool(
                    user.get("primary_role") or user.get("preferred_locations")
                ),
            },
            {
                "key": "skill_overrides",
                "label": "Skill overrides (your custom skill notes)",
                "stored": len(overrides) > 0,
            },
            {
                "key": "jobs",
                "label": "Saved job listings, ratings, Kanban status",
                "stored": jobs_total > 0,
            },
            {
                "key": "usage",
                "label": "Search & rating usage counters",
                "stored": True,
            },
        ],
    }


@router.get("/data-export")
async def export_my_data(user=Depends(get_current_user)):
    """Download everything JobRadar stores for this user (GDPR-style portability)."""
    db = get_database()
    user_id = str(user["_id"])

    jobs = await db.jobs.find({"crawled_by": user_id}).to_list(length=2000)
    exported_jobs = []
    for job in jobs:
        rating = job.get("ratings", {}).get(user_id, {})
        thread = (job.get("job_threads") or {}).get(user_id) or []
        exported_jobs.append(
            {
                "id": str(job["_id"]),
                "title": job.get("title"),
                "url": job.get("url"),
                "source": job.get("source"),
                "crawled_at": job.get("crawled_at"),
                "status": job.get(f"status_{user_id}", "NEW"),
                "hidden": bool(job.get(f"hidden_{user_id}")),
                "score": rating.get("score"),
                "verdict": rating.get("verdict"),
                "matched_strengths": rating.get("matched_strengths", []),
                "gaps": rating.get("gaps", []),
                "chat_thread": thread,
            }
        )

    cv = user.get("cv")
    cv_export = None
    if cv:
        cv_export = {
            "filename": cv.get("filename"),
            "uploaded_at": cv.get("uploaded_at"),
            "structured": cv.get("structured"),
            "raw_text_included": True,
            "raw_text": cv.get("raw_text", ""),
        }

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "account": {
            "name": user.get("name"),
            "email": user.get("email"),
            "created_at": user.get("created_at"),
        },
        "cv": cv_export,
        "preferences": {
            "preferred_locations": user.get("preferred_locations", []),
            "primary_role": user.get("primary_role"),
            "secondary_roles": user.get("secondary_roles", []),
            "job_types": user.get("job_types", {}),
            "min_salary": user.get("min_salary", 0),
            "key_skills": user.get("key_skills", []),
            "experience_level": user.get("experience_level"),
            "work_authorization": user.get("work_authorization", ""),
            "avoid_industries": user.get("avoid_industries", []),
            "work_mode": user.get("work_mode", {}),
            "about_me": user.get("about_me", ""),
            "about_me_from_cv": user.get("about_me_from_cv", ""),
            "showcase_projects": user.get("showcase_projects", []),
        },
        "skill_overrides": user.get("skill_overrides", {}),
        "jobs": exported_jobs,
    }


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(payload: DeleteAccountRequest, user=Depends(get_current_user)):
    """Permanently delete the user account and all associated data."""
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect password.",
        )

    db = get_database()
    user_id = str(user["_id"])

    result = await db.jobs.delete_many({"crawled_by": user_id})
    deleted = await db.users.delete_one({"_id": ObjectId(user["_id"])})

    if deleted.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found.")

    print(f"[privacy] Deleted account {user_id} and {result.deleted_count} jobs")
