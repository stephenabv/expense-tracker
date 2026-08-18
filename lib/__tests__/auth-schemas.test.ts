import { describe, expect, it } from "vitest";

import {
  GENDERS,
  checkPassword,
  emailOnlySchema,
  fieldErrors,
  normalizeEmail,
  normalizeName,
  passwordSatisfiesAll,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/schemas";

const VALID = {
  name: "Juan Dela Cruz",
  gender: "male",
  email: "Juan@Example.COM",
  password: "Password123!",
  confirmPassword: "Password123!",
};

describe("name", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeName("  Maria   Santos  ")).toBe("Maria Santos");
  });

  it("accepts names from any script and with punctuation", () => {
    for (const name of [
      "John Doe",
      "Maria Santos",
      "Juan Dela Cruz",
      "Ana O'Brien",
      "Nguyen Van A",
      "Piña Colada",
      "李 明",
    ]) {
      expect(signUpSchema.safeParse({ ...VALID, name }).success, name).toBe(true);
    }
  });

  it("rejects empty or whitespace-only names", () => {
    for (const name of ["", "   ", "\t\n"]) {
      expect(signUpSchema.safeParse({ ...VALID, name }).success).toBe(false);
    }
  });

  it("rejects markup", () => {
    for (const name of ["<script>alert(1)</script>", "Bob <b>", "a > b"]) {
      expect(signUpSchema.safeParse({ ...VALID, name }).success, name).toBe(false);
    }
  });

  it("rejects embedded control characters", () => {
    for (const name of ["Bad\u0000Name", "Line\u001FBreak", "Del\u007FChar"]) {
      expect(signUpSchema.safeParse({ ...VALID, name }).success).toBe(false);
    }
  });

  it("rejects a name with no letters", () => {
    expect(signUpSchema.safeParse({ ...VALID, name: "123 456" }).success).toBe(false);
  });

  it("enforces length bounds", () => {
    expect(signUpSchema.safeParse({ ...VALID, name: "A" }).success).toBe(false);
    expect(
      signUpSchema.safeParse({ ...VALID, name: "A".repeat(81) }).success,
    ).toBe(false);
  });
});

describe("gender", () => {
  it("accepts every listed option", () => {
    for (const gender of GENDERS) {
      expect(signUpSchema.safeParse({ ...VALID, gender }).success, gender).toBe(true);
    }
  });

  it("rejects a value outside the list", () => {
    for (const gender of ["", "other", "MALE", "admin", "1"]) {
      expect(signUpSchema.safeParse({ ...VALID, gender }).success, gender).toBe(false);
    }
  });
});

describe("email", () => {
  it("normalises case and whitespace", () => {
    expect(normalizeEmail("  Juan@Example.COM ")).toBe("juan@example.com");
    expect(signUpSchema.parse(VALID).email).toBe("juan@example.com");
  });

  it("rejects malformed addresses", () => {
    for (const email of [
      "john@",
      "@example.com",
      "john.example.com",
      "",
      "a b@c.com",
    ]) {
      expect(emailOnlySchema.safeParse({ email }).success, email).toBe(false);
    }
  });

  it("accepts ordinary addresses", () => {
    for (const email of ["john.doe@example.com", "a+tag@sub.example.co.uk"]) {
      expect(emailOnlySchema.safeParse({ email }).success, email).toBe(true);
    }
  });
});

describe("password", () => {
  it("accepts a password meeting every rule", () => {
    expect(passwordSatisfiesAll("Password123!")).toBe(true);
  });

  it("rejects the examples that miss a requirement", () => {
    for (const password of [
      "password",
      "password123",
      "PASSWORD123",
      "Password123",
      "Pass1!",
    ]) {
      expect(passwordSatisfiesAll(password), password).toBe(false);
      expect(
        signUpSchema.safeParse({ ...VALID, password, confirmPassword: password })
          .success,
        password,
      ).toBe(false);
    }
  });

  it("reports each rule separately for the live checklist", () => {
    expect(checkPassword("Password123!")).toEqual({
      length: true,
      lowercase: true,
      uppercase: true,
      number: true,
      special: true,
    });
    expect(checkPassword("password").uppercase).toBe(false);
    expect(checkPassword("Password123").special).toBe(false);
  });

  it("does not alter the password it validates", () => {
    const password = "  Spaces Inside 1! ";
    const parsed = signUpSchema.safeParse({
      ...VALID,
      password,
      confirmPassword: password,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.password).toBe(password);
  });

  it("bounds the length so a huge input cannot burn CPU in the hash", () => {
    const password = `A1!${"a".repeat(200)}`;
    expect(
      signUpSchema.safeParse({ ...VALID, password, confirmPassword: password })
        .success,
    ).toBe(false);
  });
});

describe("confirm password", () => {
  it("rejects a mismatch and points at the right field", () => {
    const result = signUpSchema.safeParse({
      ...VALID,
      confirmPassword: "Different123!",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error).confirmPassword).toBe(
        "Passwords do not match.",
      );
    }
  });
});

describe("sign in", () => {
  it("requires a password but does not apply the strength rules", () => {
    // Applying them here would reveal which rules an existing password meets.
    expect(
      signInSchema.safeParse({ email: "a@b.com", password: "weak" }).success,
    ).toBe(true);
    expect(signInSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(
      false,
    );
  });
});

describe("reset password", () => {
  it("applies the same strength rules as registration", () => {
    expect(
      resetPasswordSchema.safeParse({
        token: "t",
        password: "password",
        confirmPassword: "password",
      }).success,
    ).toBe(false);

    expect(
      resetPasswordSchema.safeParse({
        token: "t",
        password: "Password123!",
        confirmPassword: "Password123!",
      }).success,
    ).toBe(true);
  });

  it("requires a token", () => {
    expect(
      resetPasswordSchema.safeParse({
        token: "",
        password: "Password123!",
        confirmPassword: "Password123!",
      }).success,
    ).toBe(false);
  });
});

describe("malformed submissions", () => {
  it("rejects non-string fields without throwing", () => {
    for (const payload of [
      { ...VALID, name: 42 },
      { ...VALID, email: null },
      { ...VALID, password: {} },
      {},
    ]) {
      expect(() => signUpSchema.safeParse(payload)).not.toThrow();
      expect(signUpSchema.safeParse(payload).success).toBe(false);
    }
  });
});
