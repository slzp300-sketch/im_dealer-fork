import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeBnkResponse, BNK_MAX_DECODED_RESPONSE_BYTES } from "./bnk";

function encodeResponse(value: unknown): string {
  return deflateSync(Buffer.from(JSON.stringify(value), "utf8")).toString("base64");
}

describe("BNK response decoder", () => {
  it("decodes a raw base64+zlib JSON response (brandList/modelData/bnkfg_codes)", () => {
    const payload = { local: { kr: { brandList: "111,121" } }, brand: { "111": { name: "현대" } } };
    const raw = encodeResponse(payload);

    expect(decodeBnkResponse(raw)).toEqual(payload);
  });

  it("decodes the JSON rtnData wrapper used by rentRemain and costData", () => {
    const payload = { message: { state: "0000" }, cost: { pmtGrand: "416900" } };
    const raw = JSON.stringify({ rtnData: encodeResponse(payload), returnFunction: "returnCostData(1)" });

    expect(decodeBnkResponse(raw)).toEqual(payload);
  });

  it("decodes the rentRemain residual grid inside rtnData", () => {
    const payload = { message: { state: "0000" }, remain: { "36": { "20000": 70 } }, deliveryComp: "1345422" };
    const raw = JSON.stringify({ rtnData: encodeResponse(payload) });

    expect(decodeBnkResponse(raw)).toEqual(payload);
  });

  it("keeps uncompressed JSON responses working", () => {
    const payload = { brand: { "111": { modelList: "11896" } } };

    expect(decodeBnkResponse(JSON.stringify(payload))).toEqual(payload);
  });

  it("rejects a deterministic high-expansion response at the decoded-size ceiling", () => {
    const payload = { fixture: "bnk-bounded-expansion", payload: "A".repeat(BNK_MAX_DECODED_RESPONSE_BYTES) };
    const raw = encodeResponse(payload);

    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeGreaterThan(BNK_MAX_DECODED_RESPONSE_BYTES);
    expect(() => decodeBnkResponse(raw)).toThrow();
  });

  it("treats an HTML response as an expired session", () => {
    expect(() => decodeBnkResponse("<!doctype html><html><body>login</body></html>")).toThrow();
  });

  it("rejects corrupt compressed data", () => {
    const corrupt = Buffer.from("not-a-zlib-stream", "utf8").toString("base64");

    expect(() => decodeBnkResponse(corrupt)).toThrow();
  });
});
