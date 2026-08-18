/**
 * Session access for server code.
 *
 * `requireUserId` is the only way the data actions learn who is calling. The id
 * comes from the signed session cookie, never from a form field or a URL, so a
 * client cannot ask for another account's rows by changing a parameter.
 */

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LOGIN_ROUTE } from "@/lib/auth/routes";

export async function currentUser() {
  const session = await auth();
  return session?.user ?? null;
}

/** The signed-in user's id, or a redirect to the login page. */
export async function requireUserId(): Promise<string> {
  const user = await currentUser();
  if (!user?.id) redirect(LOGIN_ROUTE);
  return user.id;
}

/** Like `requireUserId`, but for actions that should fail rather than redirect. */
export async function getUserId(): Promise<string | null> {
  const user = await currentUser();
  return user?.id ?? null;
}
