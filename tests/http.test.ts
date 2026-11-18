import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError, readJsonObject } from "../lib/http";

const post = (body: string) => new Request("https://schedule.example/api", { method: "POST", body });

test("readJsonObject returns a JSON object body", async () => {
  assert.deepEqual(await readJsonObject(post('{"usSlotsOpen":true}')), { usSlotsOpen: true });
});

test("readJsonObject turns malformed or non-object bodies into a 400, not a 500", async () => {
  for (const body of ["{bad", "", "null", "[1]", '"text"', "5"]) {
    await assert.rejects(readJsonObject(post(body)), (error: unknown) => error instanceof HttpError && error.status === 400, body);
  }
});
