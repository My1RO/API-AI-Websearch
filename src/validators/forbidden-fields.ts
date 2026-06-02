const forbiddenKeyPatterns = [
  /quote/i,
  /member/i,
  /client/i,
  /patient/i,
  /diagnos/i,
  /medication/i,
  /prescription/i,
  /free[-_]?text/i,
  /^dob$/i,
  /dateOfBirth/i,
  /birthDate/i,
  /ssn/i,
  /email/i,
  /firstName/i,
  /lastName/i
];

export class ForbiddenFieldError extends Error {
  constructor(readonly fieldPath: string) {
    super(`Forbidden field is not allowed on AI provider profile routes: ${fieldPath}`);
  }
}

export const assertNoForbiddenFields = (value: unknown, path: string[] = []): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenFields(item, [...path, String(index)]));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => {
    const currentPath = [...path, key];
    if (forbiddenKeyPatterns.some((pattern) => pattern.test(key))) {
      throw new ForbiddenFieldError(currentPath.join("."));
    }

    assertNoForbiddenFields(nestedValue, currentPath);
  });
};
