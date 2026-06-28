import type { User } from "@prisma/client";

export type SafeUser = Omit<User, "passwordHash">;

export function safeUser(user: User): SafeUser {
  const { passwordHash, ...rest } = user;
  return rest;
}
