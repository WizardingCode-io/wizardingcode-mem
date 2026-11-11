// The Sharing card's line for a server change (ADR 0027): what the change log's `server:<id>`
// row means, run on the values the store writes, not read from the template's text.
import { describe, expect, test } from "bun:test";
import { serverChange } from "../../ui/src/sharing-text.ts";

describe("the Sharing card's last-change line for a server", () => {
  test("an add logs the host as the new value, a removal as the old one", () => {
    expect(serverChange("One", "", "one.acme.test")).toBe("server One added");
    expect(serverChange("One", "one.acme.test", "")).toBe("server One removed");
  });

  test("a mute logs `mute` as the new value and an unmute as the old one, never a removal", () => {
    expect(serverChange("One", "", "mute")).toBe("server One muted");
    expect(serverChange("One", "mute", "")).toBe("server One unmuted");
    expect(serverChange("One", "", "mute:m1")).toBe("member m1 of server One muted");
    expect(serverChange("One", "mute:m1", "")).toBe("member m1 of server One unmuted");
  });
});
