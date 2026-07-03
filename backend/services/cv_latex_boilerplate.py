"""LaTeX CV boilerplate for apply-pack copy-paste workflows."""

from __future__ import annotations

import re

# Default structure — external LLM tailors body sections from MASTER CV; keep preamble intact.
CV_LATEX_BOILERPLATE = r"""\documentclass[10pt, a4paper]{article}
\usepackage[a4paper, top=1.1cm, bottom=1.1cm, left=1.35cm, right=1.35cm]{geometry}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage{hyperref}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{microtype}
\usepackage{parskip}
\usepackage{xcolor}

\hypersetup{colorlinks=true, urlcolor=black, linkcolor=black}

\titleformat{\section}{\bfseries\normalsize}{}{0em}{}[\titlerule]
\titlespacing{\section}{0pt}{6pt}{4pt}

\pagestyle{empty}

\setlist[itemize]{leftmargin=1.4em, topsep=2pt, itemsep=1pt, parsep=0pt}
\renewcommand{\labelitemi}{\tiny\textbullet}

\begin{document}

\begin{center}
  {\LARGE \textbf{{{NAME}}}}\\[4pt]
  {{{LOCATION}}} \quad\textbar\quad
  {{{PHONE}}} \quad\textbar\quad
  \href{mailto:{{{EMAIL}}}}{{{EMAIL}}}\\[2pt]
  \href{https://linkedin.com/in/saim-kaskar-34a6a4206}{LinkedIn} \quad\textbar\quad
  \href{https://github.com/itsmesaim}{GitHub} \quad\textbar\quad
  \href{https://saimjs.com}{saimjs.com} \quad\textbar\quad
  {{{WORK_AUTH}}}
\end{center}

\vspace{-2pt}

\section{Summary}

% Tailor this paragraph for the target role using MASTER CV summary + JD keywords.
{{{SUMMARY_PLACEHOLDER}}}

\section{Technical Skills}

\begin{itemize}
  \item \textbf{AI / GenAI / Agentic Tools:} LangChain, LangGraph, LangSmith, Anthropic API, OpenAI SDK, Pydantic structured outputs, provider-agnostic LLM routing, prompt engineering, LLM observability and tracing, RAG pipelines, Pinecone, MCP, async Python (asyncio), Cursor, Claude Code
  \item \textbf{Python \& Data Science:} FastAPI, pandas, numpy, scikit-learn, Plotly, Seaborn, Jupyter Notebook, NLTK, spaCy, TF-IDF, Vector Space Models, ML model training and evaluation
  \item \textbf{Backend:} FastAPI (Python), Spring Boot (Java), Node.js, Express.js, REST APIs, JWT authentication, OpenAPI / Swagger, WebSockets / Socket.IO
  \item \textbf{Frontend:} React.js, Next.js, TypeScript, JavaScript (ES6+), Tailwind CSS, shadcn/ui, React Query, Zustand, Angular, HTML5, CSS3
  \item \textbf{Cloud \& DevOps:} AWS (EC2, S3), Azure, Docker, Docker Compose, CI/CD pipelines, VPS, Nginx, SSL, pm2, Linux, Git / GitHub
  \item \textbf{Databases:} MongoDB, MySQL, PostgreSQL, SQLite, Pinecone (vector), SQL
  \item \textbf{Testing \& Quality:} Jest, React Testing Library, unit testing, black-box testing
\end{itemize}

\section{Professional Experience}

% Reorder and reword bullets for this JD. Use only facts from MASTER CV experience.
{{{EXPERIENCE_PLACEHOLDER}}}

\section{Key Projects}

% Prioritize projects that match the JD. Use only facts from MASTER CV projects.
{{{PROJECTS_PLACEHOLDER}}}

\section{Education}

% Copy ALL education entries from MASTER CV — do not omit.
{{{EDUCATION_PLACEHOLDER}}}

\end{document}
"""


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
    out = text
    for old, new in replacements:
        out = out.replace(old, new)
    return out


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


def _work_auth_line(user: dict) -> str:
    auth = (user.get("work_authorization") or "").strip()
    if auth:
        return f"Eligible to work in Ireland ({auth})"
    about = (user.get("about_me") or "").lower()
    if "stamp 1g" in about:
        return "Eligible to work in Ireland (Stamp 1G)"
    return "Work authorization: see profile"


def personalize_boilerplate(user: dict) -> str:
    """Fill header placeholders from parsed CV; leave body placeholders for external LLM."""
    structured = (user.get("cv") or {}).get("structured") or {}
    name = structured.get("name") or user.get("name") or "Your Name"
    email = structured.get("email") or "email@example.com"
    phone = structured.get("phone") or "+353 ..."
    location = structured.get("location") or "Dublin, Ireland"
    summary = (structured.get("summary") or "").strip()
    if not summary:
        summary = "% Replace with tailored summary from MASTER CV"
    summary = _latex_escape(summary)

    exp_lines = []
    for exp in structured.get("experience", []):
        title = _latex_escape(exp.get("title") or "Role")
        company = _latex_escape(exp.get("company") or "Company")
        start = exp.get("start") or ""
        end = exp.get("end") or "Present"
        exp_lines.append(
            f"\\textbf{{{title}}} \\hfill {start}--{end}\\\\\n"
            f"\\textit{{{company}}}\n\n"
            f"\\begin{{itemize}}\n"
            + "\n".join(
                f"  \\item {_latex_escape(b)}" for b in exp.get("bullets", [])[:6]
            )
            + "\n\\end{itemize}\n"
        )
    experience = (
        "\n".join(exp_lines) if exp_lines else "% Add experience from MASTER CV"
    )

    proj_lines = []
    for p in structured.get("projects", [])[:5]:
        name_p = _latex_escape(p.get("name") or "Project")
        url = p.get("url") or ""
        url_line = f"\\href{{{url}}}{{{url}}}" if url else ""
        proj_lines.append(
            f"\\textbf{{{name_p}}}\n\n"
            f"\\begin{{itemize}}\n"
            + "\n".join(
                f"  \\item {_latex_escape(b)}" for b in p.get("bullets", [])[:5]
            )
            + f"\n\\end{{itemize}}\n"
            + (f"\n{url_line}\n" if url_line else "")
        )
    projects = "\n".join(proj_lines) if proj_lines else "% Add projects from MASTER CV"

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

    tex = CV_LATEX_BOILERPLATE
    replacements = {
        "{{{NAME}}}": name,
        "{{{LOCATION}}}": location,
        "{{{PHONE}}}": phone,
        "{{{EMAIL}}}": email,
        "{{{WORK_AUTH}}}": _work_auth_line(user),
        "{{{SUMMARY_PLACEHOLDER}}}": summary.replace("%", "\\%"),
        "{{{EXPERIENCE_PLACEHOLDER}}}": experience,
        "{{{PROJECTS_PLACEHOLDER}}}": projects,
        "{{{EDUCATION_PLACEHOLDER}}}": education,
    }
    for key, val in replacements.items():
        tex = tex.replace(key, val)
    return tex


def format_boilerplate_section(user: dict, job: dict) -> str:
    filename = suggested_tex_filename(user, job)
    body = personalize_boilerplate(user)
    return f"""
LATEX BOILERPLATE — compilable .tex starting point (tailor body for this role)
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
