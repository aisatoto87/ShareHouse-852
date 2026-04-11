/** 會員在 ShareHouse 852 的身分（對應 `profiles.role`） */
export type ProfileRole = "landlord" | "tenant" | "both";

export type ProfileRow = {
  id: string;
  role: ProfileRole | null;
  display_name: string | null;
};
