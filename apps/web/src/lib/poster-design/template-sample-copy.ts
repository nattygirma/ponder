export type PosterTemplateCopy = {
  title: string;
  subtitle: string;
  badge: string;
};

export const paperListSampleCopy = (_zh?: boolean): PosterTemplateCopy => ({
  title: "BOOKS TO COME BACK TO",
  subtitle: "The everyday\nSubtitle: Observe and remember\nThe idea: Notice the small moments. Slow down and look closely; an ordinary day can become the beginning of something meaningful. A conversation, a patch of light, or a new thought is worth keeping.\nTakeaway: A good record begins with attention. Write a little each day about how a moment felt, as well as what happened. When you return to those pages, the details bring everyday life into focus.\n\nThe art of thinking\nSubtitle: Question and understand\nThe idea: Start with a better question. Break a complex subject into smaller parts and find what is worth exploring. Before judging a different view, understand its reasons and examine your own assumptions.\nTakeaway: Look beyond the answer. Compare perspectives, keep your questions, and build a view of your own. Connect what you read with a concrete problem in your life and let understanding grow over time.",
  badge: "",
});

export const legacyPosterSampleCopy = (_zh?: boolean): PosterTemplateCopy => ({
  title: "MAKE IDEAS\nWORTH SHARING",
  subtitle: "Ideas deserve to be seen.",
  badge: "CREATIVE NOTES",
});

const TEMPLATE_SAMPLE_COPIES: Record<string, { en: PosterTemplateCopy }> = {
  "paper-list": {
    en: paperListSampleCopy(false),
  },
  folio: {
    en: {
      title: "Turn rough notes\ninto clear writing",
      subtitle: "Good writing rarely arrives all at once; it emerges through patient revision.",
      badge: "EDITORIAL · 04",
    },
  },
  brush: {
    en: {
      title: "Three habits for\nbetter note-taking",
      subtitle: "Capture key ideas, Rewrite in your words, Review every week",
      badge: "Save this!",
    },
  },
  keyword: {
    en: {
      title: "STOP THE\nSCROLL",
      subtitle: "High-impact cover design",
      badge: "VISUAL HOOK",
    },
  },
  regeng: {
    en: {
      title: "Two quiet hours\nchange everything",
      subtitle: "Protect one uninterrupted block of focus every single day.",
      badge: "DAILY DROP 01",
    },
  },
  highlight: {
    en: {
      title: "How to remember\nwhat you read",
      subtitle: "Close the book and explain its core argument in three sentences.",
      badge: "READING GUIDE",
    },
  },
  frame: {
    en: {
      title: "STAY CURIOUS\nKEEP BUILDING",
      subtitle: "Leave room for every new idea to grow.",
      badge: "MANIFESTO",
    },
  },
  sage: {
    en: {
      title: "Slow down to think\nwith clarity",
      subtitle: "Collect scattered thoughts on paper; patterns appear when you revisit them.",
      badge: "FIELD NOTES",
    },
  },
  notes: {
    en: {
      title: "Ten-minute evening\nmind reset",
      subtitle: "Write tomorrow's top three priorities\nBreak stuck tasks into one first step\nClose the laptop and rest",
      badge: "Today 22:30 · Notes",
    },
  },
  interview: {
    en: {
      title: "What interviewers\nactually look for",
      subtitle: "Walk through real trade-offs instead of reciting textbook answers.",
      badge: "CAREER TIPS",
    },
  },
  riso: {
    en: {
      title: "Field guide for\nindie creators",
      subtitle: "Find the joy of making in tactile, imperfect print.",
      badge: "ZINE 03",
    },
  },
  kicker: {
    en: {
      title: "Build a minimum\nviable second brain",
      subtitle: "Why do hundreds of saved bookmarks disappear when you need them?",
      badge: "WORKFLOW",
    },
  },
  numeral: {
    en: {
      title: "Three questions\nfor deeper thinking",
      subtitle: "What is true, why it matters, and what if the opposite held.",
      badge: "03",
    },
  },
  calendar: {
    en: {
      title: "Focus on one\nmeaningful task",
      subtitle: "Do not wait for perfect conditions; write the first line now.",
      badge: "DAILY CHECK-IN",
    },
  },
  ticket: {
    en: {
      title: "WEEKEND IDEA\nSALON & SCREENING",
      subtitle: "Bring your curiosity for an evening of talks and short films.",
      badge: "ADMIT ONE",
    },
  },
  corner: {
    en: {
      title: "21-Day Writing\nHabit Builder",
      subtitle: "Lower the friction and make daily output effortless",
      badge: "ACTION PLAN",
    },
  },
  polaroid: {
    en: {
      title: "Golden hour\nby the coast",
      subtitle: "Some moments are meant to be kept before they are shared.",
      badge: "SUMMER FILM · 2026",
    },
  },
  serial: {
    en: {
      title: "How good tools\nshape our thinking",
      subtitle: "Every Friday on product craft, reading, and digital life.",
      badge: "Weekly 12",
    },
  },
  chat: {
    en: {
      title: "Skip perfection.\nFinishing the first draft is half the win.",
      subtitle: "How do I stop overthinking and start writing?",
      badge: "CREATOR Q&A",
    },
  },
  window: {
    en: {
      title: "Plain-text notes\nthat last for decades",
      subtitle: "Fast, portable, and searchable without format lock-in.",
      badge: "notes-guide.md",
    },
  },
  newspaper: {
    en: {
      title: "Reclaiming deep\nreading in a noisy age",
      subtitle: "Trade ten fleeting feeds for one essay that stands the test of time.",
      badge: "THE REVIEW 08",
    },
  },
  stack: {
    en: {
      title: "THINK CLEARLY",
      subtitle: "Keep your own rhythm and judgment in a noisy world.",
      badge: "MANIFESTO",
    },
  },
  bili: {
    en: {
      title: "Color theory\nexplained in 10 mins",
      subtitle: "A practical breakdown of contrast, hierarchy, and palette balance",
      badge: "EXPLAINER",
    },
  },
  pop: {
    en: {
      title: "Weekend ideas\nworth trying out",
      subtitle: "Collect playful details and fresh perspectives around town",
      badge: "PLAYBOOK",
    },
  },
  swiss: {
    en: {
      title: "LESS IS MORE\nGRID & ORDER",
      subtitle: "Restrained proportion and whitespace let the message speak.",
      badge: "01",
    },
  },
  collage: {
    en: {
      title: "Little moments\nkept on paper",
      subtitle: "Coffee notes, ticket stubs, and sketches from an ordinary week.",
      badge: "JOURNAL",
    },
  },
  mega: {
    en: {
      title: "START NOW\nSHIP FAST",
      subtitle: "Done beats perfect—take the first concrete step today",
      badge: "ACTION",
    },
  },
  ticker: {
    en: {
      title: "Top productivity\ntools of the year",
      subtitle: "Thirty apps tested in real workflows; only five made the cut.",
      badge: "BEST OF 2026",
    },
  },
  memo: {
    en: {
      title: "The Feynman\nlearning method",
      subtitle: "If you cannot explain it simply, you do not understand it yet.",
      badge: "STUDY NOTE",
    },
  },
  mag: {
    en: {
      title: "The art of\nlong-term craft",
      subtitle: "In an age of instant feedback, patience remains a quiet superpower.",
      badge: "ISSUE 07",
    },
  },
  print: {
    en: {
      title: "TYPE, GRID\n& PRINT FORM",
      subtitle: "Classic typographic proportion meets modern poster craft",
      badge: "EXHIBITION 02",
    },
  },
  bento: {
    en: {
      title: "Three steps to\na clear review",
      subtitle: "Revisit the goal, Spot key gaps, Define next actions",
      badge: "BENTO LIST",
    },
  },
  calm: {
    en: {
      title: "Leave space\nfor quiet thought",
      subtitle: "Not every hour needs a plan; clarity grows in the pauses.",
      badge: "QUIET NOTES",
    },
  },
  seal: {
    en: {
      title: "Still waters\nrun deep",
      subtitle: "Patience and quiet craft outlast the noise.",
      badge: "SEAL",
    },
  },
  compare: {
    en: {
      title: "Before & After Rewrite",
      subtitle: "Vague clutter | Clear value",
      badge: "COPY CLINIC",
    },
  },
  split: {
    en: {
      title: "Natural light\nin warm interiors",
      subtitle: "Afternoon side-light brings quiet depth to everyday spaces.",
      badge: "05",
    },
  },
  impact: {
    en: {
      title: "STOP WORKING\nBLINDLY",
      subtitle: "Avoid the three hidden traps that drain your focus",
      badge: "DEEP DIVE",
    },
  },
  neon: {
    en: {
      title: "NEXT-GEN AI\nWORKFLOWS",
      subtitle: "Automate repetitive tasks and save your energy for real creation.",
      badge: "AI LAB",
    },
  },
  quote: {
    en: {
      title: "We write to taste life twice, in the moment and in retrospect.",
      subtitle: "— Notes on keeping a daily journal",
      badge: "QUOTATION",
    },
  },
  cinema: {
    en: {
      title: "THE LONG ROAD\nHOME",
      subtitle: "Every detour eventually becomes part of the story",
      badge: "A SHORT FILM",
    },
  },
  minimal: {
    en: {
      title: "Clarity over\ncomplexity",
      subtitle: "Remove the noise until only the essential argument remains.",
      badge: "MINIMALISM",
    },
  },
  bold: {
    en: {
      title: "State your main\nidea in one line",
      subtitle: "Hook the reader in three seconds by leading with what matters.",
      badge: "HIGH IMPACT",
    },
  },
  poster: {
    en: {
      title: "PROTECT YOUR\nFOCUS TODAY",
      subtitle: "Replace endless overthinking with one decisive step forward.",
      badge: "REMINDER",
    },
  },
  number: {
    en: {
      title: "Five habits for\na clutter-free desk",
      subtitle: "Three minutes of reset each evening for a calmer morning.",
      badge: "5",
    },
  },
  neo: {
    en: {
      title: "Break the rules\nbuild bold things",
      subtitle: "Distinctive work gets remembered; safe work gets scrolled past",
      badge: "MUST READ",
    },
  },
  acid: {
    en: {
      title: "FUTURE SOUND\n& VISUAL ART",
      subtitle: "Exploring generative light, grain, and expressive typography",
      badge: "TREND",
    },
  },
  glass: {
    en: {
      title: "Your personal\ncreative studio",
      subtitle: "Capture fleeting notes, draft essays, and design covers in one place.",
      badge: "RELEASE",
    },
  },
  editorial: {
    en: {
      title: "The lasting value\nof deep essays",
      subtitle: "Making room for questions that deserve slow, careful thought.",
      badge: "COVER STORY",
    },
  },
  dark: {
    en: {
      title: "Building reliable\nlocal-first apps",
      subtitle: "Instant response and offline resilience for modern workflows.",
      badge: "TECH GUIDE",
    },
  },
  sticker: {
    en: {
      title: "Cozy weekend\nreset ritual",
      subtitle: "Morning sun, a good paperback, and a slow homemade brunch.",
      badge: "LIFESTYLE",
    },
  },
  gradient: {
    en: {
      title: "Turn experience\ninto playbooks",
      subtitle: "Every lesson learned becomes a stepping stone for the next project.",
      badge: "GROWTH",
    },
  },
  center: {
    en: {
      title: "Good design is\nquiet and clear",
      subtitle: "Balanced whitespace guides the eye naturally to what matters",
      badge: "DESIGN",
    },
  },
  checklist: {
    en: {
      title: "Four checks before\nyou hit publish",
      subtitle: "Clear headline, Strong cover, Breathable paragraphs, Concrete takeaway",
      badge: "CHECKLIST",
    },
  },
  soft: {
    en: {
      title: "Make room for\ngentle days",
      subtitle: "Move at your own pace and let quiet moments unfold naturally.",
      badge: "MOOD NOTE",
    },
  },
};

export function posterTemplateSampleCopy(templateId: string, zh?: boolean): PosterTemplateCopy {
  const entry = TEMPLATE_SAMPLE_COPIES[templateId];
  const sample = entry ? entry.en : legacyPosterSampleCopy(zh);
  return { ...sample };
}
