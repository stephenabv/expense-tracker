import { redirect } from "next/navigation";

import { currentUser } from "@/lib/server/session";
import { DEFAULT_AUTHENTICATED_ROUTE, LOGIN_ROUTE } from "@/lib/auth/routes";

/** The entry point simply routes to the right place for the visitor. */
export default async function Home() {
  const user = await currentUser();
  redirect(user ? DEFAULT_AUTHENTICATED_ROUTE : LOGIN_ROUTE);
}
