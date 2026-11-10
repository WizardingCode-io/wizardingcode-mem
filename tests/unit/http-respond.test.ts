import { describe, expect, test } from "bun:test";
import { json, jsonObject, problem } from "../../src/http/respond.ts";

const post = (body: string) => new Request("http://local/x", { method: "POST", body });

describe("http respond helpers", () => {
  test("json sets the content type, no-store, the status and extra headers", async () => {
    const response = json({ a: 1 }, 201, { "x-request-id": "r1" });
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("r1");
    expect(await response.json()).toEqual({ a: 1 });
    expect(json({}).status).toBe(200);
  });

  test("problem nests the error and the extras", async () => {
    const response = problem(409, "contract", { accepted: [1] });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "contract", accepted: [1] });
    expect(await problem(404, "not found").json()).toEqual({ error: "not found" });
  });

  test("jsonObject answers 400 for a body that is not JSON or not an object", async () => {
    const notJson = await jsonObject(post("nope"));
    expect(notJson).toBeInstanceOf(Response);
    expect((notJson as Response).status).toBe(400);
    expect(await (notJson as Response).json()).toEqual({ error: "body must be JSON" });
    const array = await jsonObject(post("[1]"));
    expect((array as Response).status).toBe(400);
    expect(await (array as Response).json()).toEqual({ error: "body must be an object" });
    const nul = await jsonObject(post("null"));
    expect((nul as Response).status).toBe(400);
  });

  test("jsonObject returns the object otherwise", async () => {
    expect(await jsonObject(post('{"k":1}'))).toEqual({ k: 1 });
  });
});
