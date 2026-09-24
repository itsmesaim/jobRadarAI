"""LaTeX CV boilerplate for apply-pack copy-paste workflows."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urlparse

# Geometry skins for cv_template_preset (classic | compact | technical).
_TEMPLATE_GEOMETRY = {
    "classic": r"\usepackage[a4paper, top=1.1cm, bottom=1.1cm, left=1.35cm, right=1.35cm]{geometry}",
    "compact": r"\usepackage[a4paper, top=0.85cm, bottom=0.85cm, left=1.1cm, right=1.1cm]{geometry}",
    "technical": r"\usepackage[a4paper, top=1.0cm, bottom=1.0cm, left=1.2cm, right=1.2cm]{geometry}",
}
_TEMPLATE_TITLE_SPACING = {
    "classic": r"\titlespacing{\section}{0pt}{6pt}{4pt}",
    "compact": r"\titlespacing{\section}{0pt}{4pt}{2pt}",
    "technical": r"\titlespacing{\section}{0pt}{5pt}{3pt}",
}
_DEFAULT_SECTIONS = (
    "summary",
    "skills",
    "experience",
    "projects",
    "education",
)
_SECTION_TITLES = {
    "summary": "Summary",
    "skills": "Technical Skills",
    "experience": "Professional Experience",
    "projects": "Key Projects",
    "education": "Education",
}
_SECTION_PLACEHOLDERS = {
    "summary": "{{{SUMMARY_PLACEHOLDER}}}",
    "skills": "{{{SKILLS_PLACEHOLDER}}}",
    "experience": "{{{EXPERIENCE_PLACEHOLDER}}}",
    "projects": "{{{PROJECTS_PLACEHOLDER}}}",
    "education": "{{{EDUCATION_PLACEHOLDER}}}",
}

# Default structure, external LLM tailors body sections from MASTER CV; keep preamble intact.
# {{{GEOMETRY}}} / {{{TITLE_SPACING}}} / {{{BODY_SECTIONS}}} filled by _boilerplate_for_user.
CV_LATEX_BOILERPLATE = r"""\documentclass[10pt, a4paper]{article}
{{{GEOMETRY}}}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage{hyperref}
\usepackage{fontspec}
\IfFontExistsTF{Latin Modern Roman}{\setmainfont{Latin Modern Roman}}{\setmainfont{DejaVu Serif}}
\usepackage{microtype}
\usepackage{parskip}
\usepackage{xcolor}

\hypersetup{colorlinks=true, urlcolor=black, linkcolor=black}

\titleformat{\section}{\bfseries\normalsize}{}{0em}{}[\titlerule]
{{{TITLE_SPACING}}}

\pagestyle{empty}

\setlist[itemize]{leftmargin=1.4em, topsep=2pt, itemsep=1pt, parsep=0pt}
\renewcommand{\labelitemi}{\tiny\textbullet}

\begin{document}

\begin{center}
  {\LARGE \textbf{NAME_PLACEHOLDER}}\\[4pt]
  {{{CONTACT_LINE}}}\\[2pt]
  {{{LINKS_LINE}}}
\end{center}

\vspace{-2pt}

{{{BODY_SECTIONS}}}

\end{document}
"""


def _normalize_template_prefs(user: dict) -> tuple[str, list[str]]:
    """Return (preset, ordered visible section keys)."""
    preset = (user.get("cv_template_preset") or "classic").strip().lower()
    if preset not in _TEMPLATE_GEOMETRY:
        preset = "classic"
    raw = user.get("cv_sections") or {}
    # Technical defaults to skills-forward unless user set an order.
    if preset == "technical":
        order = ("skills", "summary", "experience", "projects", "education")
    else:
        order = list(_DEFAULT_SECTIONS)
    if isinstance(raw, dict) and isinstance(raw.get("order"), list) and raw["order"]:
        cleaned = [
            s for s in raw["order"] if isinstance(s, str) and s in _SECTION_TITLES
        ]
        for s in _DEFAULT_SECTIONS:
            if s not in cleaned:
                cleaned.append(s)
        order = cleaned
    visible = []
    for key in order:
        if isinstance(raw, dict) and key in raw and raw[key] is False:
            continue
        visible.append(key)
    if not visible:
        visible = list(_DEFAULT_SECTIONS)
    return preset, visible


def _boilerplate_for_user(user: dict) -> str:
    preset, sections = _normalize_template_prefs(user)
    body_parts = []
    for key in sections:
        title = _SECTION_TITLES[key]
        ph = _SECTION_PLACEHOLDERS[key]
        body_parts.append(f"\\section{{{title}}}\n\n{ph}\n")
    tex = CV_LATEX_BOILERPLATE
    tex = tex.replace("{{{GEOMETRY}}}", _TEMPLATE_GEOMETRY[preset])
    tex = tex.replace("{{{TITLE_SPACING}}}", _TEMPLATE_TITLE_SPACING[preset])
    tex = tex.replace("{{{BODY_SECTIONS}}}", "\n".join(body_parts))
    return tex


def _de_emdash(text: str) -> str:
    """Em dashes read as AI-generated to a lot of hiring managers. Comma or hyphen."""
    if not text:
        return text
    text = re.sub(r"\s*\u2014\s*", ", ", text)
    return text.replace("\u2014", "-")


def _latex_escape(text: str) -> str:
    if not text:
        return ""
    replacements = [
        ("\\", r"\textbackslash{}"),
        ("%", r"\%"),
        ("&", r"\&"),
        ("#", r"\#"),
        ("_", r"\_"),
        ("{", r"\{"),
        ("}", r"\}"),
    ]
    out = _de_emdash(text)
    for old, new in replacements:
        out = out.replace(old, new)
    return out


_MEASURED_BY_RE = re.compile(
    r",?\s*(?:as measured by|measured by)\s+[^,.;]+(?=,|\.|;|$)", re.IGNORECASE
)


def _clean_bullet(b) -> str:
    """Strips any measured-by clause from a TailoredBullet (services.apply_pack) that
    isn't backed by a real MASTER CV metric, regardless of what the bullet text claims.
    """
    if b.has_real_metric:
        return b.text
    return _MEASURED_BY_RE.sub("", b.text).strip()


_SAFE_URL_RE = re.compile(
    r"^https?://[A-Za-z0-9](?:[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]*)$"
)


def _safe_url(url: str | None) -> str | None:
    """CV-extracted URLs are untrusted text ending up inside a LaTeX \\href{} target, an
    argument hyperref doesn't reliably catcode-escape the way body text does. Reject
    anything that isn't a clean http(s) URL rather than trust LLM/CV-controlled input,
    a malformed or adversarial string here could break compilation or inject LaTeX.
    CVs usually list bare domains ("example.com", not "https://example.com"), so a
    missing scheme is normalized in before validating, it isn't treated as malformed."""
    if not url:
        return None
    url = url.strip()
    if not re.match(r"^https?://", url, re.IGNORECASE):
        if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", url):
            return None  # some other scheme (javascript:, data:, mailto:, ...), reject outright
        url = f"https://{url}"
    if len(url) > 300 or not _SAFE_URL_RE.match(url):
        return None
    return url


def _slug_part(text: str, max_len: int = 24) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", (text or "").strip())
    s = s.strip("_")
    return (s[:max_len] or "Role").rstrip("_")


def suggested_tex_filename(user: dict, job: dict) -> str:
    structured = (user.get("cv") or {}).get("structured") or {}
    name = structured.get("name") or user.get("name") or "Candidate"
    name_part = _slug_part(name.replace(" ", "_"), 40)
    company = _slug_part(job.get("company") or "Company", 20)
    role = _slug_part(job.get("title") or "Role", 28)
    return f"{name_part}_CV_{company}_{role}.tex"


_FILLER_WORDS = {
    "senior",
    "junior",
    "staff",
    "principal",
    "lead",
    "the",
    "and",
    "of",
    "a",
    "for",
}


def _abbreviate(
    text: str, max_word_len: int = 5, max_words: int = 3, fallback: str = "Role"
) -> str:
    words = [w for w in re.split(r"[^A-Za-z0-9]+", text or "") if w]
    significant = [w for w in words if w.lower() not in _FILLER_WORDS] or words
    parts = [w[:max_word_len].capitalize() for w in significant[:max_words]]
    return "".join(parts) or fallback


def suggested_pdf_filename(user: dict, job: dict, suffix: str = "") -> str:
    """Compact download filename: username_company_role.pdf, company/role shortened to
    a handful of letters each so it stays readable in a downloads folder, unlike
    suggested_tex_filename() above (still used for the longer, unambiguous name inside
    the zero-LLM handoff text, a different context where brevity doesn't matter)."""
    structured = (user.get("cv") or {}).get("structured") or {}
    username = _abbreviate(
        structured.get("name") or user.get("name") or "User",
        max_word_len=12,
        max_words=1,
        fallback="User",
    )
    company = _abbreviate(
        job.get("company") or "Company", max_word_len=6, max_words=1, fallback="Co"
    )
    role = _abbreviate(job.get("title") or "Role")
    tail = f"_{suffix}" if suffix else ""
    return f"{username}_{company}_{role}{tail}.pdf"


def _display_url(url: str, *, host_only: bool = False) -> str:
    """Visible link text: hostname, or host/path for GitHub repos and project demos."""
    parsed = urlparse(url)
    host = (parsed.netloc or "").removeprefix("www.")
    path = (parsed.path or "").rstrip("/")
    if host_only or not path:
        return host or url
    return f"{host}{path}"


def _contact_line(user: dict) -> str:
    """City/phone/email from the CV they uploaded, not from job-search locations."""
    structured = (user.get("cv") or {}).get("structured") or {}
    parts = []
    loc = (structured.get("location") or "").strip()
    if loc:
        parts.append(_latex_escape(loc))
    phone = (structured.get("phone") or "").strip()
    if phone:
        parts.append(_latex_escape(phone))
    email = (structured.get("email") or "").strip()
    if email:
        parts.append(
            f"\\href{{mailto:{_latex_escape(email)}}}{{{_latex_escape(email)}}}"
        )
    return " \\quad\\textbar\\quad ".join(parts)


def _header_links_line(user: dict) -> str:
    """Second header line from THIS user's links + visa/location, not a fixed Ireland line."""
    structured = (user.get("cv") or {}).get("structured") or {}
    links = structured.get("links") or {}
    parts = []
    linkedin = _safe_url(links.get("linkedin"))
    if linkedin:
        parts.append(f"\\href{{{linkedin}}}{{LinkedIn}}")
    github = _safe_url(links.get("github"))
    if github:
        parts.append(f"\\href{{{github}}}{{GitHub}}")
    website = _safe_url(links.get("website"))
    if website:
        label = _latex_escape(_display_url(website, host_only=True))
        parts.append(f"\\href{{{website}}}{{{label}}}")
    auth = _work_auth_line(user)
    if auth:
        parts.append(auth)
    if not parts:
        return ""
    return " \\quad\\textbar\\quad ".join(parts)


def _work_auth_line(user: dict) -> str:
    """Built only from what the user explicitly declared in Settings
    (nationality, visa_country, visa_type) - never guessed from the CV's
    free-text location, which conflates city and country."""
    nationality = (user.get("nationality") or "").strip()
    country = (user.get("visa_country") or "").strip()
    visa_type = (user.get("visa_type") or "").strip()

    lead = f"{nationality} national" if nationality else ""
    if country and visa_type:
        elig = f"eligible to work in {country} ({visa_type})"
    elif country:
        elig = f"eligible to work in {country}"
    elif visa_type:
        elig = visa_type
    else:
        elig = ""

    line = " - ".join(p for p in (lead, elig) if p)
    return _latex_escape(line) if line else ""


_CATEGORY_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _closest_real_category(
    produced: str, real_categories: dict[str, str]
) -> str | None:
    """Deterministic backstop for when the LLM names a category that's close but not
    an exact match ("Cloud Technologies" vs the real "Cloud & DevOps"), remaps to the
    best token-overlap real category instead of silently dropping the whole group,
    same reasoning as the prompt-only-doesn't-hold pattern used elsewhere in rating.
    """
    produced_tokens = set(_CATEGORY_TOKEN_RE.findall(produced.lower()))
    if not produced_tokens:
        return None
    best_name, best_overlap = None, 0
    for real_lower, real_name in real_categories.items():
        overlap = len(produced_tokens & set(_CATEGORY_TOKEN_RE.findall(real_lower)))
        if overlap > best_overlap:
            best_name, best_overlap = real_name, overlap
    return best_name


def _render_skills(skills_data: list) -> str:
    if not skills_data:
        return "% Add skills from MASTER CV"
    if isinstance(skills_data[0], dict):
        lines = [
            f"\\textbf{{{_latex_escape(g.get('category', 'Other'))}:}} "
            + ", ".join(_latex_escape(s) for s in g.get("items", []))
            for g in skills_data
            if g.get("items")
        ]
        return "\\\\\n".join(lines) if lines else "% Add skills from MASTER CV"
    # Legacy flat-list shape, CVs parsed before categorization was added.
    return (
        "\\begin{itemize}\n  \\item "
        + ", ".join(_latex_escape(s) for s in skills_data)
        + "\n\\end{itemize}"
    )


def _project_links_line(p: dict) -> str:
    """jobradar.saimjs.com | github.com/user/repo, not the words Live/Code.
    p["url"] is the legacy pre-live_url/repo_url field."""
    live = _safe_url(p.get("live_url") or p.get("url"))
    repo = _safe_url(p.get("repo_url"))
    links = []
    if live:
        label = _latex_escape(_display_url(live))
        links.append(f"\\href{{{live}}}{{{label}}}")
    if repo:
        label = _latex_escape(_display_url(repo))
        links.append(f"\\href{{{repo}}}{{{label}}}")
    return " \\quad\\textbar\\quad ".join(links)


def _date_range_line(start: str | None, end: str | None) -> str:
    """A one-off event with no real duration (both start and end empty/null) renders
    with no date segment at all, rather than defaulting a missing end to "Present" and
    making a hackathon look like an ongoing job."""
    start = (start or "").strip()
    end = (end or "").strip()
    if not start and not end:
        return ""
    return f" \\hfill {start}--{end or 'Present'}"


def personalize_boilerplate(
    user: dict,
    experience_override: str | None = None,
    projects_override: str | None = None,
    summary_override: str | None = None,
    skills_override: str | None = None,
) -> str:
    """Fill header placeholders from parsed CV; leave body placeholders for external LLM.

    The _override params let assemble_tailored_tex() reuse this same header/education
    logic for the in-app PDF path, where Summary/Skills/Experience/Projects come from
    the already-tailored LLM output instead of the raw, untailored MASTER CV dump.
    """
    structured = (user.get("cv") or {}).get("structured") or {}
    name = structured.get("name") or user.get("name") or "Your Name"
    if summary_override is not None:
        summary = summary_override
    else:
        summary = (structured.get("summary") or "").strip()
        if not summary:
            summary = "% Replace with tailored summary from MASTER CV"
        summary = _latex_escape(summary)

    skills = (
        skills_override
        if skills_override is not None
        else _render_skills(structured.get("skills", []))
    )

    exp_lines = []
    for exp in structured.get("experience", []):
        title = _latex_escape(exp.get("title") or "Role")
        company = _latex_escape(exp.get("company") or "Company")
        date_line = _date_range_line(exp.get("start"), exp.get("end"))
        exp_lines.append(
            f"\\textbf{{{title}}}{date_line}\\\\\n"
            f"\\textit{{{company}}}\n\n"
            f"\\begin{{itemize}}\n"
            + "\n".join(
                f"  \\item {_latex_escape(b)}" for b in exp.get("bullets", [])[:6]
            )
            + "\n\\end{itemize}\n"
        )
    experience = (
        experience_override
        if experience_override is not None
        else ("\n".join(exp_lines) if exp_lines else "% Add experience from MASTER CV")
    )

    proj_lines = []
    for p in structured.get("projects", [])[:5]:
        name_p = _latex_escape(p.get("name") or "Project")
        url_line = _project_links_line(p)
        date_line = _date_range_line(p.get("start"), p.get("end"))
        head = f"\\textbf{{{name_p}}}{date_line}"
        if url_line:
            head += f"\\\\\n{{\\small {url_line}}}"
        proj_lines.append(
            f"{head}\n\n"
            f"\\begin{{itemize}}\n"
            + "\n".join(
                f"  \\item {_latex_escape(b)}" for b in p.get("bullets", [])[:5]
            )
            + "\n\\end{itemize}\n"
        )
    projects = (
        projects_override
        if projects_override is not None
        else ("\n".join(proj_lines) if proj_lines else "% Add projects from MASTER CV")
    )

    edu_lines = []
    for edu in structured.get("education", []):
        degree = _latex_escape(edu.get("degree") or "Degree")
        inst = _latex_escape(edu.get("institution") or "Institution")
        start = edu.get("start") or ""
        end = edu.get("end") or ""
        grade = edu.get("grade")
        grade_part = f" \\textbar{{}} {grade}" if grade else ""
        edu_lines.append(
            f"\\textbf{{{degree}}} \\hfill {start}--{end}\\\\\n"
            f"{inst}{grade_part}\n\n\\vspace{{3pt}}"
        )
    education = "\n".join(edu_lines) if edu_lines else "% Add education from MASTER CV"

    tex = _boilerplate_for_user(user)
    replacements = {
        "NAME_PLACEHOLDER": _latex_escape(name),
        "{{{CONTACT_LINE}}}": _contact_line(user),
        "{{{LINKS_LINE}}}": _header_links_line(user),
        "{{{SUMMARY_PLACEHOLDER}}}": summary,
        "{{{SKILLS_PLACEHOLDER}}}": skills,
        "{{{EXPERIENCE_PLACEHOLDER}}}": experience,
        "{{{PROJECTS_PLACEHOLDER}}}": projects,
        "{{{EDUCATION_PLACEHOLDER}}}": education,
    }
    for key, val in replacements.items():
        tex = tex.replace(key, val)
    return tex


COVER_LETTER_LATEX_BOILERPLATE = r"""\documentclass[11pt, a4paper]{article}
\usepackage[a4paper, top=2cm, bottom=2cm, left=2.2cm, right=2.2cm]{geometry}
\usepackage{fontspec}
\IfFontExistsTF{Latin Modern Roman}{\setmainfont{Latin Modern Roman}}{\setmainfont{DejaVu Serif}}
\usepackage{microtype}
\usepackage{parskip}
\usepackage{hyperref}
\hypersetup{colorlinks=true, urlcolor=black, linkcolor=black}
\pagestyle{empty}

\begin{document}

\begin{center}
  {\large \textbf{NAME_PLACEHOLDER}}\\[2pt]
  {{{CONTACT_LINE}}}\\[2pt]
  {{{LINKS_LINE}}}
\end{center}

\vspace{1cm}
{{{DATE_PLACEHOLDER}}}

\vspace{0.5cm}
Re: {{{ROLE_PLACEHOLDER}}} at {{{COMPANY_PLACEHOLDER}}}

\vspace{0.5cm}
Dear Hiring Team,

\vspace{0.3cm}
{{{BODY_PLACEHOLDER}}}

\vspace{0.5cm}
Best regards,\\
NAME_PLACEHOLDER

\end{document}
"""


def assemble_cover_letter_tex(user: dict, job: dict, parsed) -> str:
    """Letter-shell template around the already-generated 4-part cover_letter (strongest
    match, concrete example, gaps named, close), no LLM call here, the writing already
    happened in generate_apply_pack_stream. Joined into paragraph form for the letter body.
    """
    structured = (user.get("cv") or {}).get("structured") or {}
    name = structured.get("name") or user.get("name") or "Your Name"

    cl = parsed.cover_letter
    parts = [cl.strongest_match, cl.concrete_example, *cl.gaps_named, cl.close]
    body = "\n\n".join(p.strip() for p in parts if p and str(p).strip())

    tex = COVER_LETTER_LATEX_BOILERPLATE
    replacements = {
        "NAME_PLACEHOLDER": _latex_escape(name),
        "{{{CONTACT_LINE}}}": _contact_line(user),
        "{{{LINKS_LINE}}}": _header_links_line(user),
        "{{{DATE_PLACEHOLDER}}}": datetime.now(timezone.utc).strftime("%B %-d, %Y"),
        "{{{ROLE_PLACEHOLDER}}}": _latex_escape(job.get("title") or "the role"),
        "{{{COMPANY_PLACEHOLDER}}}": _latex_escape(
            job.get("company") or "your company"
        ),
        "{{{BODY_PLACEHOLDER}}}": _latex_escape(body),
    }
    for key, val in replacements.items():
        tex = tex.replace(key, val)
    return tex


def compile_apply_pack_cover_letter_pdf(user: dict, job: dict, parsed) -> bytes:
    from services.pdf_compile import compile_tex_to_pdf

    tex = assemble_cover_letter_tex(user, job, parsed)
    pdf_bytes, _page_count = compile_tex_to_pdf(tex)
    return pdf_bytes


def assemble_tailored_tex(user: dict, job: dict, parsed) -> tuple[str, list[str]]:
    """Deterministically merges the already-tailored LLM output (parsed: ApplyPackContent)
    into the CV boilerplate for the Download-PDF path. No LLM call here, the tailoring
    already happened in generate_apply_pack_stream. Returns (tex, dropped_names), non-empty
    when the LLM named a project or experience role that isn't real MASTER CV data, those
    entries are skipped rather than fabricated into the PDF.
    """
    structured = (user.get("cv") or {}).get("structured") or {}
    real_projects_by_name = {
        (p.get("name") or "").strip().lower(): p
        for p in structured.get("projects", [])
        if p.get("name")
    }
    real_experience_by_company = {
        (e.get("company") or "").strip().lower(): e
        for e in structured.get("experience", [])
        if e.get("company")
    }

    dropped: list[str] = []

    exp_lines = []
    for role in parsed.tailored_experience:
        real_role = real_experience_by_company.get(role.company.strip().lower())
        if not real_role:
            dropped.append(role.company)
            continue
        title = _latex_escape(real_role.get("title") or "Role")
        company = _latex_escape(real_role.get("company") or "")
        date_line = _date_range_line(real_role.get("start"), real_role.get("end"))
        bullets_tex = "\n".join(
            f"  \\item {_latex_escape(_clean_bullet(b))}" for b in role.bullets
        )
        exp_lines.append(
            f"\\textbf{{{title}}}{date_line}\\\\\n"
            f"\\textit{{{company}}}\n\n"
            f"\\begin{{itemize}}\n{bullets_tex}\n\\end{{itemize}}\n"
        )
    experience_tex = (
        "\n".join(exp_lines) if exp_lines else "% No matching experience selected"
    )

    proj_lines = []
    for sp in parsed.selected_projects:
        real_project = real_projects_by_name.get(sp.name.strip().lower())
        if not real_project:
            dropped.append(sp.name)
            continue
        url_line = _project_links_line(real_project)
        date_line = _date_range_line(real_project.get("start"), real_project.get("end"))
        head = f"\\textbf{{{_latex_escape(real_project['name'])}}}{date_line}"
        if url_line:
            head += f"\\\\\n{{\\small {url_line}}}"
        proj_lines.append(
            f"{head}\n\n"
            "\\begin{itemize}\n"
            + "\n".join(f"  \\item {_latex_escape(b)}" for b in sp.bullets[:6])
            + "\n\\end{itemize}\n"
        )
    projects_tex = (
        "\n".join(proj_lines) if proj_lines else "% No matching projects selected"
    )

    summary_tex = _latex_escape((parsed.tailored_summary or "").strip()) or (
        "% Replace with tailored summary from MASTER CV"
    )

    real_categories = {
        (g.get("category") or "").strip().lower(): g.get("category")
        for g in structured.get("skills", [])
        if isinstance(g, dict) and g.get("category")
    }
    valid_skill_groups = []
    for sg in parsed.selected_skills:
        if not sg.items:
            continue
        real_category = real_categories.get(
            sg.category.strip().lower()
        ) or _closest_real_category(sg.category, real_categories)
        if not real_category:
            continue
        valid_skill_groups.append({"category": real_category, "items": sg.items})
    skills_tex = _render_skills(valid_skill_groups)

    tex = personalize_boilerplate(
        user,
        experience_override=experience_tex,
        projects_override=projects_tex,
        summary_override=summary_tex,
        skills_override=skills_tex,
    )
    return tex, dropped


EXPERIENCE_BULLET_FLOOR = 3
MAX_OVERFLOW_TRIM_ITERATIONS = 8


def _trim_one_bullet(tailored_experience: list) -> tuple[list, bool]:
    """Drops the last bullet from whichever role currently holds the most bullets above
    EXPERIENCE_BULLET_FLOOR. Never brings a role at or under the floor, so this can't
    reintroduce the under-fill bug it's meant to avoid, a role that already has fewer
    real bullets than the floor (a short leadership entry) is left untouched. Returns
    (new_list, trimmed), trimmed is False once every role is at/under the floor.
    """
    best_idx = None
    best_count = EXPERIENCE_BULLET_FLOOR
    for i, role in enumerate(tailored_experience):
        if len(role.bullets) > best_count:
            best_idx = i
            best_count = len(role.bullets)
    if best_idx is None:
        return tailored_experience, False
    new_list = list(tailored_experience)
    role = new_list[best_idx]
    new_list[best_idx] = role.model_copy(update={"bullets": role.bullets[:-1]})
    return new_list, True


def compile_apply_pack_cv_pdf(
    user: dict, job: dict, parsed
) -> tuple[bytes, bool, list[str]]:
    """assemble_tailored_tex() + compile, trimming experience bullets one at a time
    (most over-provisioned role first, floor at EXPERIENCE_BULLET_FLOOR) if the first
    compile runs past 1 page, recompiling after each. Projects are never dropped to
    force a page fit, the 3-4 project minimum wins over the 1-page ceiling. Returns
    (pdf_bytes, overflow, dropped_names); overflow is True if still >1 page once every
    role is at its floor, the download still succeeds either way.
    """
    from services.pdf_compile import compile_tex_to_pdf

    tex, dropped = assemble_tailored_tex(user, job, parsed)
    pdf_bytes, page_count = compile_tex_to_pdf(tex)

    current = parsed
    iterations = 0
    while page_count > 1 and iterations < MAX_OVERFLOW_TRIM_ITERATIONS:
        new_experience, trimmed = _trim_one_bullet(current.tailored_experience)
        if not trimmed:
            break
        current = current.model_copy(update={"tailored_experience": new_experience})
        tex, dropped = assemble_tailored_tex(user, job, current)
        pdf_bytes, page_count = compile_tex_to_pdf(tex)
        iterations += 1

    # No project-drop fallback: the 3-4 project minimum wins over the 1-page ceiling.
    # Once every role is at its bullet floor and it still doesn't fit, ship it as a
    # (flagged) 2-page PDF with every selected project intact rather than silently
    # dropping below the stated minimum to force a single page.
    return pdf_bytes, page_count > 1, dropped


def format_boilerplate_section(user: dict, job: dict) -> str:
    filename = suggested_tex_filename(user, job)
    body = personalize_boilerplate(user)
    return f"""
LATEX BOILERPLATE, compilable .tex starting point (tailor body for this role)
{"=" * 42}
Suggested filename: {filename}
Compile: pdflatex {filename}   (or paste into Overleaf → Recompile)

Rules for the external LLM:
- Keep \\documentclass, \\usepackage, geometry, and section structure UNCHANGED.
- Replace Summary, Skills groups, Experience bullets, Key Projects, and Education
  using ONLY MASTER CV facts, reordered/emphasized for this JD.
- Escape LaTeX specials in text: % → \\%, & → \\&, _ → \\_ (except in \\texttt).
- Do not invent metrics, tools, or roles not in MASTER CV.

```latex
{body}
```
""".strip()
