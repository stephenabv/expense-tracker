import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      gender?: string;
    } & DefaultSession["user"];
  }

  interface User {
    gender?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    gender?: string;
  }
}
