// One pastel colour per course, in order of adding. Text colours pass contrast on their backgrounds.
export interface CourseColor {
  bg: string;
  border: string;
  text: string;
}

export const COURSE_COLORS: CourseColor[] = [
  { bg: "#ece6fa", border: "#cbbcf0", text: "#45238a" },
  { bg: "#dcebfb", border: "#b5d2f3", text: "#1c4b80" },
  { bg: "#d8f1e7", border: "#acdfca", text: "#1b5a43" },
  { bg: "#fbecd3", border: "#efd09d", text: "#74460f" },
  { bg: "#f9dfe7", border: "#efb9ca", text: "#852343" },
  { bg: "#dff2f6", border: "#b2dfe9", text: "#155668" },
  { bg: "#efebd9", border: "#dbd2ad", text: "#574a17" },
  { bg: "#e8e8f0", border: "#c9c9d8", text: "#363650" },
];

export function colorFor(index: number): CourseColor {
  return COURSE_COLORS[index % COURSE_COLORS.length];
}
