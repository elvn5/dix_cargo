import { ApiError } from "../api/client";

/** Посылка, у которой уже есть такой трек-код (из ответа 409 duplicate_track). */
export interface DuplicateTrack {
  id: number;
  track_code: string;
  status: "IN_OFFICE" | "IN_TRANSIT" | "DELIVERED";
  user_id: number;
  client_code: string;
  full_name: string;
  in_trash: boolean;
}

/** Посылка-дубль из ошибки API (409 duplicate_track), иначе null. */
export function duplicateTrackFrom(e: unknown): DuplicateTrack | null {
  if (e instanceof ApiError && e.status === 409 && e.message === "duplicate_track") {
    return (e.data?.existing as DuplicateTrack | undefined) ?? null;
  }
  return null;
}
