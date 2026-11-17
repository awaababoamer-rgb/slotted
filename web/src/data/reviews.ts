// Course and professor reviews.
// Reviews are anonymous to students: we read them through the `reviews_public`
// view, which never includes who wrote them (only `is_mine` for your own).
// Row-level security makes sure students can only edit/delete their own.

import { requireSupabase } from "./supabase";

export interface Review {
  id: string;
  course_code: string;
  professor: string;
  term_taken: string; // "Fall 2025"
  overall: number;
  difficulty: number;
  workload: number;
  would_take_again: boolean;
  comment: string;
  created_at: string;
  updated_at: string;
  is_mine: boolean;
}

export type ReviewInput = Pick<Review,
  "course_code" | "professor" | "term_taken" | "overall" | "difficulty" | "workload" | "would_take_again" | "comment">;

export interface Ratings {
  course_code: string;
  professor?: string;
  review_count: number;
  overall: number;
  difficulty: number;
  workload: number;
  would_take_again_pct: number;
}

const REVIEW_COLUMNS =
  "id,course_code,professor,term_taken,overall,difficulty,workload,would_take_again,comment,created_at,updated_at,is_mine";

export async function listReviews(courseCode: string): Promise<Review[]> {
  const { data, error } = await requireSupabase()
    .from("reviews_public")
    .select(REVIEW_COLUMNS)
    .eq("course_code", courseCode)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Couldn't load reviews: ${error.message}`);
  return (data ?? []) as Review[];
}

const toRatings = (r: Record<string, unknown>): Ratings => ({
  course_code: r.course_code as string,
  professor: r.professor as string | undefined,
  review_count: Number(r.review_count),
  overall: Number(r.overall),
  difficulty: Number(r.difficulty),
  workload: Number(r.workload),
  would_take_again_pct: Number(r.would_take_again_pct),
});

export async function courseRatings(courseCode: string): Promise<Ratings | null> {
  const { data, error } = await requireSupabase().from("course_ratings").select("*").eq("course_code", courseCode).maybeSingle();
  if (error) throw new Error(`Couldn't load ratings: ${error.message}`);
  return data ? toRatings(data) : null;
}

/** Every professor's average per course, keyed "COURSE|Professor" (for the Builder). */
export async function allProfessorRatings(): Promise<Map<string, Ratings>> {
  const { data, error } = await requireSupabase().from("professor_ratings").select("*");
  if (error) throw new Error(`Couldn't load professor ratings: ${error.message}`);
  return new Map((data ?? []).map((r) => [`${r.course_code}|${r.professor}`, toRatings(r)]));
}

function friendly(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("You've already reviewed this course for that term. Edit your existing review instead.");
  if (error.code === "23514") return new Error("Please check the ratings (1–5) and the term.");
  return new Error(error.message);
}

export async function createReview(input: ReviewInput): Promise<void> {
  const { error } = await requireSupabase().from("reviews").insert(input);
  if (error) throw friendly(error);
}

export async function updateReview(id: string, input: ReviewInput): Promise<void> {
  const { data, error } = await requireSupabase().from("reviews").update(input).eq("id", id).select("id");
  if (error) throw friendly(error);
  if (!data || data.length === 0) throw new Error("You can only edit your own reviews.");
}

export async function deleteReview(id: string): Promise<void> {
  const { data, error } = await requireSupabase().from("reviews").delete().eq("id", id).select("id");
  if (error) throw new Error(`Couldn't delete the review: ${error.message}`);
  if (!data || data.length === 0) throw new Error("You can only delete your own reviews.");
}

export async function reportReview(id: string, reason: string): Promise<void> {
  const { error } = await requireSupabase().from("review_reports").insert({ review_id: id, reason: reason.trim() });
  if (error) {
    if (error.code === "23505") throw new Error("You've already reported this review. Thanks.");
    throw new Error(`Couldn't report the review: ${error.message}`);
  }
}

// ---- Admin moderation ----

export interface ReportedReview {
  review: Review;
  reasons: string[];
  reportIds: string[];
}

/** Open reports grouped by review (admins only; the database refuses others). */
export async function listReportedReviews(): Promise<ReportedReview[]> {
  const db = requireSupabase();
  const { data: reports, error } = await db
    .from("review_reports")
    .select("id,review_id,reason,created_at")
    .is("resolved_at", null)
    .order("created_at");
  if (error) throw new Error(`Couldn't load reports: ${error.message}`);
  const ids = [...new Set((reports ?? []).map((r) => r.review_id as string))];
  if (ids.length === 0) return [];
  const { data: reviews, error: e2 } = await db.from("reviews_public").select(REVIEW_COLUMNS).in("id", ids);
  if (e2) throw new Error(`Couldn't load reported reviews: ${e2.message}`);
  const byId = new Map(((reviews ?? []) as Review[]).map((r) => [r.id, r]));
  return ids
    .filter((id) => byId.has(id))
    .map((id) => {
      const mine = (reports ?? []).filter((r) => r.review_id === id);
      return { review: byId.get(id)!, reasons: mine.map((r) => (r.reason as string) || "(no reason given)"), reportIds: mine.map((r) => r.id as string) };
    });
}

/** "Keep": the review stays; its reports are marked resolved. */
export async function keepReview(reportIds: string[]): Promise<void> {
  const { error } = await requireSupabase()
    .from("review_reports")
    .update({ resolved_at: new Date().toISOString() })
    .in("id", reportIds);
  if (error) throw new Error(`Couldn't resolve the reports: ${error.message}`);
}

/** "Remove": deletes the review (its reports go with it). */
export async function removeReview(id: string): Promise<void> {
  await deleteReview(id).catch((e: Error) => {
    throw new Error(e.message.replace("You can only delete your own reviews.", "Only admins can remove other people's reviews."));
  });
}

/** Recent terms for the "term taken" picker, newest first. */
export function recentTerms(count = 12): string[] {
  const now = new Date();
  let year = now.getFullYear();
  const month = now.getMonth() + 1;
  let season: "Fall" | "Summer" | "Winter" = month >= 9 ? "Fall" : month >= 5 ? "Summer" : "Winter";
  const terms: string[] = [];
  for (let i = 0; i < count; i++) {
    terms.push(`${season} ${year}`);
    if (season === "Fall") season = "Summer";
    else if (season === "Summer") season = "Winter";
    else { season = "Fall"; year -= 1; }
  }
  return terms;
}

/** A Rate My Professors search for this name (a link only; we never copy their data). */
export function rateMyProfessorsUrl(professor: string): string {
  return `https://www.ratemyprofessors.com/search/professors?q=${encodeURIComponent(professor)}`;
}

/** Every course's averages, keyed by course code (for Find courses). */
export async function allCourseRatings(): Promise<Map<string, Ratings>> {
  const { data, error } = await requireSupabase().from("course_ratings").select("*");
  if (error) throw new Error(`Couldn't load course ratings: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.course_code as string, toRatings(row)]));
}
