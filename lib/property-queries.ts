import { createSupabaseServerClient } from "@/lib/supabase";
import { mapRowToProperty } from "@/lib/property-mapper";
import type { Property } from "@/types/property";

export async function fetchAllProperties(): Promise<Property[]> {
  const supabase = createSupabaseServerClient();
  // `*` 包含 habit_* 等所有欄位；室友配對必須能讀到四個習慣分數
  const { data, error } = await supabase.from("properties").select("*");

  if (error) {
    console.error("[Supabase] fetchAllProperties:", error.message);
    return [];
  }

  if (!data?.length) return [];

  return data.map((row) => mapRowToProperty(row as Record<string, unknown>));
}

export async function fetchPropertyById(id: string): Promise<Property | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return null;
    }
    console.error("[Supabase] fetchPropertyById:", error.message);
    return null;
  }

  if (!data) return null;

  return mapRowToProperty(data as Record<string, unknown>);
}
