import { assertSafeOidcUrl } from "../services/oidc.service";

describe("OIDC server-side URL validation", () => {
  const previousEnvironment = process.env;

  beforeEach(() => {
    process.env = { ...previousEnvironment };
    delete process.env.OIDC_ALLOW_PRIVATE_ISSUER;
  });

  afterAll(() => {
    process.env = previousEnvironment;
  });

  it.each([
    "http://login.example.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.20.30.40",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]",
    "https://user:password@8.8.8.8",
    "https://8.8.8.8/issuer?target=internal",
  ])("rejects unsafe issuer or endpoint %s", async value => {
    await expect(assertSafeOidcUrl(value)).rejects.toThrow();
  });

  it("accepts a credential-free public HTTPS endpoint", async () => {
    await expect(assertSafeOidcUrl("https://8.8.8.8/oidc")).resolves.toBeInstanceOf(URL);
  });

  it("requires an explicit host override for a deliberately private IdP", async () => {
    process.env.OIDC_ALLOW_PRIVATE_ISSUER = "true";
    await expect(assertSafeOidcUrl("https://10.20.30.40/oidc")).resolves.toBeInstanceOf(URL);
  });
});
