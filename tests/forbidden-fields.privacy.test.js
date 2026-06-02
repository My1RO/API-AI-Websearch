const {
  ForbiddenFieldError,
  assertNoForbiddenFields
} = require("../src/validators/forbidden-fields");

describe("AI provider profile forbidden field guard", () => {
  const allowedRequest = {
    providers: [
      {
        providerId: "provider-123",
        npi: "1234567890",
        name: "Dr. Ada Smith",
        specialty: "Cardiology",
        city: "Boston",
        state: "MA",
        zip: "02108"
      }
    ],
    lineOfCoverage: "Medical"
  };

  it("allows the public provider lookup request shape", () => {
    expect(() => assertNoForbiddenFields(allowedRequest)).not.toThrow();
  });

  it.each([
    "quote",
    "quoteId",
    "member",
    "memberId",
    "client",
    "clientId",
    "patient",
    "patientId",
    "DOB",
    "dob",
    "dateOfBirth",
    "birthDate",
    "diagnosis",
    "diagnosisCode",
    "medication",
    "medicationList",
    "freeText",
    "free_text",
    "freeTextNote"
  ])("rejects forbidden key %s anywhere in the request payload", (fieldName) => {
    const payload = {
      ...allowedRequest,
      providers: [
        {
          ...allowedRequest.providers[0],
          nested: {
            [fieldName]: "must never reach AI provider profile handling"
          }
        }
      ]
    };

    expect(() => assertNoForbiddenFields(payload)).toThrow(ForbiddenFieldError);
  });

  it("reports the nested field path so callers can reject without logging payload content", () => {
    expect(() =>
      assertNoForbiddenFields({
        providers: [{ name: "Dr. Ada Smith", patient: { dob: "1970-01-01" } }]
      })
    ).toThrow(/providers\.0\.patient/);
  });
});
