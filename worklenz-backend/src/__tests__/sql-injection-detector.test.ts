describe("SQL injection detector", () => {
  it("checks null-prototype request objects without failing open", () => {
    const { sqlInjectionDetector } = require("../middlewares/sql-injection-detector");
    const query = Object.create(null);
    query.search = "normal project name";
    const next = jest.fn();
    const status = jest.fn(() => ({ json: jest.fn() }));

    sqlInjectionDetector(
      {
        path: "/secure/login",
        query,
        body: Object.assign(Object.create(null), {
          email: "owner@example.test",
          color_code: "#1677ff",
        }),
        params: Object.create(null),
        headers: {},
        socket: {},
      },
      { status },
      next,
    );

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
