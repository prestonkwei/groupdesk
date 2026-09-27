/*
 * Offline checks for the fiddly parts of ingestion: which header the real
 * sender comes from, threading ids, subject normalisation, token encryption.
 * No database or network needed — run it after touching lib/gmail/ingest.ts.
 */
import { randomBytes } from "node:crypto";

process.env.GROUP_EMAIL ??= "help@example.org";
process.env.TOKEN_ENC_KEY ??= randomBytes(32).toString("base64");

import PostalMime from "postal-mime";
import { __test } from "../src/lib/gmail/ingest";
import { isDigestSubject, taggedSubject, ticketNumberFromSubject } from "../src/lib/ticket-subject";
import { decryptSecret, encryptSecret } from "../src/lib/crypto";

/** A group-rewritten reply: From says the list, the person is in X-Original-From. */
const REWRITTEN = `Delivered-To: agent@example.org
From: "helpdesk" <help@example.org>
X-Original-From: Jamie Rivera <jrivera@example.org>
Reply-To: jrivera@example.org
To: help@example.org
Cc: Dana Lee <dlee@example.org>
Subject: Re: Re: [helpdesk] Projector in room 204 won't turn on
Message-ID: <CAH1abc123@mail.gmail.com>
In-Reply-To: <CAH0zzz000@mail.gmail.com>
References: <CAH0aaa111@mail.gmail.com> <CAH0zzz000@mail.gmail.com>
List-Id: <help.example.org>
Date: Mon, 22 Sep 2026 09:14:00 -0700
Content-Type: text/plain; charset="UTF-8"

The bulb indicator is flashing orange. Tried the reset already.
`;

const DIRECT = `From: Sam Okafor <sokafor@example.org>
To: help@example.org
Subject: Printer jam
Message-ID: <plain@mail.gmail.com>

Paper is stuck in tray 2.
`;

type Check = [label: string, actual: unknown, expected: unknown];

async function main() {
  const rewritten = await PostalMime.parse(REWRITTEN);
  const direct = await PostalMime.parse(DIRECT);
  const noOriginal = await PostalMime.parse(
    REWRITTEN.replace(
      "X-Original-From: Jamie Rivera <jrivera@example.org>\n",
      "",
    ),
  );

  const sender = __test.realSender(rewritten);
  const refs = __test.referenceIds(rewritten);

  const checks: Check[] = [
    ["X-Original-From beats the rewritten From", sender.email, "jrivera@example.org"],
    ["sender display name", sender.name, "Jamie Rivera"],
    ["Message-ID parsed", rewritten.messageId, "<CAH1abc123@mail.gmail.com>"],
    ["References count", refs.length, 2],
    ["References order preserved", refs[1], "<CAH0zzz000@mail.gmail.com>"],
    [
      "repeated Re: stripped for the ticket subject",
      __test.stripReplyPrefix(rewritten.subject ?? ""),
      "[helpdesk] Projector in room 204 won't turn on",
    ],
    ["Cc parsed", (rewritten.cc ?? []).length, 1],
    [
      "falls back to Reply-To when only the list is in From",
      __test.realSender(noOriginal).email,
      "jrivera@example.org",
    ],
    ["direct mail uses From", __test.realSender(direct).email, "sokafor@example.org"],
    [
      "ticket tag stripped from a reply's subject",
      __test.stripReplyPrefix("Re: RE: [TICKET: #1058] Copies of CC notes"),
      "Copies of CC notes",
    ],
    ["ticket number read from subject", ticketNumberFromSubject("Re: [TICKET: #1058] Copies"), 1058],
    ["no tag, no number", ticketNumberFromSubject("Copies of CC notes"), null],
    ["reply subject is tagged once", taggedSubject(1058, "[TICKET: #1058] Copies"), "[TICKET: #1058] Copies"],
    ["replies to the digest are recognised", isDigestSubject("Re: [helpdesk digest] 4 open, 2 pending"), true],
    ["ordinary subjects are not digests", isDigestSubject("Digest of CC notes"), false],
    ["bare address parses", __test.parseAddress("a@b.co")?.email, "a@b.co"],
    ["non-address rejected", __test.parseAddress("not an address"), null],
  ];

  const token = "1//0abcdefgh-refresh-token";
  const blob = encryptSecret(token);
  checks.push(
    ["encryption round-trips", decryptSecret(blob), token],
    ["ciphertext is versioned", blob.startsWith("v1."), true],
    ["ciphertext hides the token", blob.includes(token), false],
  );

  let failed = 0;
  for (const [label, actual, expected] of checks) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed++;
    console.log(`${ok ? "  ok  " : " FAIL "} ${label}`);
    if (!ok) {
      console.log(
        `        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }

  console.log(
    failed === 0
      ? `\n${checks.length} checks passed`
      : `\n${failed} of ${checks.length} checks failed`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
