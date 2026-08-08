"""
CV routes.

POST /cv/upload  , upload CV (PDF, DOCX, ODT, TXT, TeX), parse it, store in MongoDB
GET  /cv/me      , return current user's parsed CV
DELETE /cv/me    , remove CV (so user can re-upload)
"""

from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from database import get_database
from deps import get_current_user
from services.cv_parser import process_cv
from services.limits import check_ai_token_quota, check_and_increment_cv_upload

router = APIRouter(prefix="/cv", tags=["cv"])

MAX_CV_SIZE = 5 * 1024 * 1024  # 5MB
ALLOWED_EXTENSIONS = {"pdf", "docx", "odt", "txt", "tex"}


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_cv(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    # ── basic validation ──────────────────────────────────
    # Extension, not content-type, browsers send inconsistent/empty MIME
    # types for .odt/.tex, so the filename suffix is the reliable signal.
    extension = (
        (file.filename or "").rsplit(".", 1)[-1].lower() if file.filename else ""
    )
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PDF, Word (.docx), OpenDocument (.odt), .txt, or .tex files are accepted.",
        )

    file_bytes = await file.read()

    if len(file_bytes) > MAX_CV_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File must be under 5MB.",
        )

    upload_ok, upload_msg = await check_and_increment_cv_upload(user)
    if not upload_ok:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=upload_msg,
        )

    token_ok, token_msg = await check_ai_token_quota(user)
    if not token_ok:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=token_msg,
        )

    # ── parse ─────────────────────────────────────────────
    try:
        raw_text, structured = await process_cv(file_bytes, extension, user=user)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        )

    # ── store in MongoDB ──────────────────────────────────
    db = get_database()
    update: dict = {
        "$set": {
            "cv": {
                "raw_text": raw_text,
                "structured": structured,
                "uploaded_at": datetime.now(timezone.utc),
                "filename": file.filename,
            }
        },
        "$unset": {"cv_embedding": ""},
    }

    # Auto-fill Settings fields that overlap 1:1 with parsed CV data, so the
    # user isn't manually re-typing what's already on their CV. Always
    # overwrites with the latest CV's values (per product decision), only
    # when the CV actually has that field, never wipe a field with nothing.
    autofilled = _autofill_preferences_from_cv(structured)
    if autofilled:
        update["$set"].update(autofilled)

    await db.users.update_one({"_id": ObjectId(user["_id"])}, update)

    return {
        "message": "CV uploaded and parsed successfully.",
        "structured": structured,
        "autofilled_fields": list(autofilled.keys()),
    }


def _autofill_preferences_from_cv(structured: dict) -> dict:
    """Maps parsed CV fields onto the matching Settings/preferences fields.
    ponytail: takes experience[0] as the most recent role (CVs are conventionally
    listed most-recent-first); upgrade to parsing start/end dates if that assumption
    ever proves wrong in practice."""
    fields: dict = {}

    experience = structured.get("experience") or []
    if experience and experience[0].get("title"):
        fields["primary_role"] = experience[0]["title"]

    location = structured.get("location")
    if location:
        fields["preferred_locations"] = [location]

    skills = structured.get("skills") or []
    if skills:
        fields["key_skills"] = skills

    summary = structured.get("summary")
    if summary:
        fields["about_me"] = summary

    return fields


@router.get("/me")
async def get_my_cv(user=Depends(get_current_user)):
    cv = user.get("cv")
    if not cv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No CV uploaded yet.",
        )
    # don't return raw_text in list view, it's large
    return {
        "filename": cv.get("filename"),
        "uploaded_at": cv.get("uploaded_at"),
        "structured": cv.get("structured"),
    }


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_cv(user=Depends(get_current_user)):
    db = get_database()
    await db.users.update_one(
        {"_id": ObjectId(user["_id"])},
        {"$unset": {"cv": "", "cv_embedding": ""}},
    )
