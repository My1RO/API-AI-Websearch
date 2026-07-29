const ORIGINAL_ENV = process.env;

const loadMiddleware = () => {
  jest.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: "production"
  };

  return require("../src/middleware/auth-context.middleware").authContextMiddleware;
};

const requestWithHeaders = (headers) => ({
  header: (name) => headers[name.toLowerCase()]
});

describe("AI auth context minimization", () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.resetModules();
  });

  it("requires only trusted organization context in production and discards identity/network headers", () => {
    const middleware = loadMiddleware();
    const request = requestWithHeaders({
      "lifecycle-subdomain": "broker-org",
      "lifecycle-user-class": "producer",
      "lifecycle-user-id": "individual-user-123",
      "user-id": "individual-user-456",
      "ip-address": "192.0.2.1",
      "x-forwarded-for": "192.0.2.2",
      origin: "https://broker-org.example.com"
    });
    const next = jest.fn();

    expect(() => middleware(request, {}, next)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);
    expect(request.authContext).toEqual(expect.objectContaining({
      subdomain: "broker-org",
      userClass: "producer"
    }));
    expect(request.authContext).not.toHaveProperty("userId");
    expect(request.authContext).not.toHaveProperty("ipAddress");
    expect(request.authContext).not.toHaveProperty("origin");
    expect(JSON.stringify(request.authContext)).not.toMatch(/individual-user|192\.0\.2|example\.com/);
  });

  it("fails closed in production when organization context is absent", () => {
    const middleware = loadMiddleware();
    const request = requestWithHeaders({
      "lifecycle-user-id": "individual-user-123"
    });

    expect(() => middleware(request, {}, jest.fn())).toThrow(/Missing Public-API request context/);
  });
});
