// Programs (degree modules) entered by the team, for the optional program chooser.
// Students read published programs; only admins can change them (row-level security).

import { requireSupabase } from "./supabase";

export interface Requirement {
  id: string;
  program_id: string;
  kind: "required" | "choose";
  title: string;
  choose_count: number;
  course_codes: string[];
  sort_order: number;
}

export interface Program {
  id: string;
  name: string;
  short_name: string;
  year: number;
  description: string;
  calendar_url: string;
  published: boolean;
  requirements: Requirement[];
}

export type ProgramInput = Omit<Program, "id" | "requirements">;
export type RequirementInput = Omit<Requirement, "id" | "program_id">;

const PROGRAM_COLUMNS = "id,name,short_name,year,description,calendar_url,published,program_requirements(id,program_id,kind,title,choose_count,course_codes,sort_order)";

export async function listPrograms(): Promise<Program[]> {
  const { data, error } = await requireSupabase()
    .from("programs")
    .select(PROGRAM_COLUMNS)
    .order("short_name")
    .order("year");
  if (error) throw new Error(`Couldn't load programs: ${error.message}`);
  return (data ?? []).map((row) => {
    const { program_requirements, ...rest } = row as unknown as Omit<Program, "requirements"> & { program_requirements: Requirement[] };
    return {
      ...rest,
      requirements: [...(program_requirements ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)),
    };
  });
}

function friendly(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new Error("A program with that name and year already exists.");
  if (error.code === "23514") return new Error("Check the fields (the calendar link must start with https://).");
  if (error.code === "42501" || /row-level security/i.test(error.message)) return new Error("Only admins can edit programs.");
  return new Error(error.message);
}

export async function createProgram(input: ProgramInput): Promise<string> {
  const { data, error } = await requireSupabase().from("programs").insert(input).select("id").single();
  if (error) throw friendly(error);
  return data.id as string;
}

export async function updateProgram(id: string, input: Partial<ProgramInput>): Promise<void> {
  const { error } = await requireSupabase().from("programs").update(input).eq("id", id);
  if (error) throw friendly(error);
}

export async function deleteProgram(id: string): Promise<void> {
  const { error } = await requireSupabase().from("programs").delete().eq("id", id);
  if (error) throw friendly(error);
}

export async function addRequirement(programId: string, input: RequirementInput): Promise<void> {
  const { error } = await requireSupabase().from("program_requirements").insert({ ...input, program_id: programId });
  if (error) throw friendly(error);
}

export async function updateRequirement(id: string, input: Partial<RequirementInput>): Promise<void> {
  const { error } = await requireSupabase().from("program_requirements").update(input).eq("id", id);
  if (error) throw friendly(error);
}

export async function deleteRequirement(id: string): Promise<void> {
  const { error } = await requireSupabase().from("program_requirements").delete().eq("id", id);
  if (error) throw friendly(error);
}
