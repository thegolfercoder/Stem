export const SITE = {
  name: "Add Maths 0606",
  longName: "IGCSE Additional Mathematics 0606",
  tagline: "Everything you need to master IGCSE Additional Mathematics.",
  description:
    "A complete study platform for Cambridge IGCSE Additional Mathematics (0606): full syllabus notes, worked examples, exam-style questions with solutions, a random question generator, timed exam simulator and progress tracking.",
  /** Override at build time with NEXT_PUBLIC_SITE_URL for correct canonical URLs. */
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com",
  syllabusYears: "2025, 2026 and 2027",
} as const;

export interface NavItem {
  href: string;
  label: string;
  description: string;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Home", description: "Start here" },
  { href: "/syllabus/", label: "Syllabus", description: "All 14 Cambridge topics, objective by objective" },
  { href: "/topics/", label: "Topics", description: "Full notes for every part of the course" },
  { href: "/formulas/", label: "Formula sheet", description: "Given and not-given formulas in one place" },
  { href: "/examples/", label: "Worked examples", description: "Every solution, step by step" },
  { href: "/practice/", label: "Practice", description: "Random questions with instant marking" },
  { href: "/exam/", label: "Exam simulator", description: "Timed papers, marked, with a performance breakdown" },
  { href: "/past-papers/", label: "Past-paper style", description: "Full exam-style questions by topic" },
  { href: "/tools/", label: "Tools", description: "Graphing, solvers and calculators" },
  { href: "/exam-technique/", label: "Exam technique", description: "How to earn the marks you have already worked for" },
  { href: "/planner/", label: "Revision planner", description: "Build a schedule that reaches your exam date" },
  { href: "/glossary/", label: "Glossary", description: "Every term the syllabus expects you to know" },
  { href: "/progress/", label: "Progress", description: "Accuracy, weak areas and what to do next" },
];

/** The links promoted into the desktop header; the rest live in the menu. */
export const PRIMARY_NAV = [
  "/topics/",
  "/practice/",
  "/exam/",
  "/formulas/",
  "/past-papers/",
];
