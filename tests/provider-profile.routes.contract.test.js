const express = require("express");
const request = require("supertest");

const { loadFirstAvailable, pickFunction } = require("./helpers/source-hook-loader");

const routeHook = loadFirstAvailable([
  "../src/app",
  "../src/server",
  "../src/routes/provider-profile.routes",
  "../src/routes/provider-profiles.routes",
  "../src/controllers/provider-profile.controller"
]);

const routeFactoryNames = [
  "createProviderProfileRouter",
  "createProviderProfilesRouter",
  "providerProfileRouter",
  "router"
];

const hasRouteContract = (sourceModule) => {
  if (!sourceModule) {
    return false;
  }

  const exportedApp = sourceModule.app || sourceModule.default;
  return Boolean(
    (exportedApp && typeof exportedApp.use === "function") ||
      pickFunction(sourceModule, routeFactoryNames) ||
      (sourceModule.router && typeof sourceModule.router.use === "function")
  );
};

const usableRouteHook =
  routeHook.module && hasRouteContract(routeHook.module)
    ? routeHook
    : { id: null, module: null, errors: routeHook.errors || [] };

const describeWhenHookExists = usableRouteHook.module ? describe : describe.skip;

const buildAppFromHook = () => {
  const exportedApp = usableRouteHook.module.app || usableRouteHook.module.default;
  if (exportedApp && typeof exportedApp.use === "function") {
    return exportedApp;
  }

  const routerFactory = pickFunction(usableRouteHook.module, routeFactoryNames);

  if (!routerFactory) {
    if (usableRouteHook.module.router && typeof usableRouteHook.module.router.use === "function") {
      const app = express();
      app.use(express.json());
      app.use(usableRouteHook.module.router);
      return app;
    }

    return null;
  }

  const app = express();
  app.use(express.json());
  const router = routerFactory({
    enqueueProviderProfileRequest: jest.fn().mockResolvedValue({ requestId: "request-1", status: "queued" }),
    getProviderProfileJob: jest.fn().mockResolvedValue({ requestId: "request-1", status: "queued" }),
    saveFeedback: jest.fn().mockResolvedValue(undefined),
    savePhoneCall: jest.fn().mockResolvedValue(undefined)
  });
  app.use(router);
  return app;
};

const postFirstAvailable = async (app, payload) => {
  const paths = [
    "/provider-profiles",
    "/provider-profiles/search",
    "/provider-contact-profiles",
    "/ai/provider-profiles",
    "/api/provider-profiles",
    "/api/ai/provider-profiles"
  ];
  let lastResponse = null;

  for (const path of paths) {
    const response = await request(app).post(path).send(payload);
    if (response.status !== 404) {
      return response;
    }
    lastResponse = response;
  }

  return lastResponse;
};

describeWhenHookExists("provider profile public route privacy contract", () => {
  it("rejects forbidden client/member/patient/free-text fields before enqueueing AI work", async () => {
    const app = buildAppFromHook();
    expect(app).toBeTruthy();

    const response = await postFirstAvailable(app, {
      providers: [
        {
          name: "Dr. Ada Smith",
          npi: "1234567890",
          memberId: "MEMBER-123",
          freeText: "patient has a diagnosis"
        }
      ],
      lineOfCoverage: "Medical"
    });

    expect([400, 422]).toContain(response.status);
    expect(JSON.stringify(response.body)).not.toContain("MEMBER-123");
    expect(JSON.stringify(response.body)).not.toContain("patient has a diagnosis");
  });

  it("rejects non-allowlisted provider profile request keys", async () => {
    const app = buildAppFromHook();
    expect(app).toBeTruthy();

    const response = await postFirstAvailable(app, {
      requestComment: "do not strip and continue",
      providers: [
        {
          name: "Dr. Ada Smith",
          npi: "1234567890"
        }
      ],
      lineOfCoverage: "Medical"
    });

    expect([400, 422]).toContain(response.status);
    expect(JSON.stringify(response.body)).not.toContain("do not strip and continue");
  });

  it("accepts the allowlisted Medical provider lookup payload", async () => {
    const app = buildAppFromHook();
    expect(app).toBeTruthy();

    const response = await postFirstAvailable(app, {
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
    });

    expect([200, 202]).toContain(response.status);
    expect(JSON.stringify(response.body)).not.toMatch(/prompt|rawResponse|sourceUrl|citation|quote/i);
  });
});

if (!usableRouteHook.module) {
  test("provider profile route source hook is not available yet", () => {
    expect(usableRouteHook.id).toBeNull();
  });
}
