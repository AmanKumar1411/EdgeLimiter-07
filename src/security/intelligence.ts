import type { Env } from "../types/env";
import type {
  SecurityLogRow,
  TopAbusiveIpRow,
} from "../types/security";

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

export type AttackIntelligence = {
  aiSummary: string;
  abuseScore: "Low" | "Medium" | "High" | "Critical";
  recommendation: string;
};

type AiJsonResponse = {
  summary?: unknown;
  abuseScore?: unknown;
  recommendation?: unknown;
};

export async function generateAttackIntelligence(
  env: Env,
  tenantId: string,
  recentLogs: SecurityLogRow[],
  topAbusiveIps: TopAbusiveIpRow[]
): Promise<AttackIntelligence> {
  const fallback = buildHeuristicIntelligence(
    recentLogs,
    topAbusiveIps
  );

  if (!recentLogs.length) {
    return fallback;
  }

  try {
    const result = await env.AI.run(AI_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You are a security analyst for an edge rate limiter. Return strict JSON only with keys summary, abuseScore, and recommendation. abuseScore must be one of Low, Medium, High, Critical.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task:
              "Analyze repeated blocked requests, burst attacks from the same IP, same IP across multiple tenants, and unusual country access.",
            tenantId,
            recentLogs: recentLogs.slice(0, 40).map((log) => ({
              route: log.route,
              ipAddress: log.ip_address,
              country: log.country,
              colo: log.colo,
              userAgent: log.user_agent,
              allowed: Boolean(log.allowed),
              remaining: log.remaining,
              retryAfter: log.retry_after,
              reason: log.reason,
              createdAt: log.created_at,
            })),
            topAbusiveIps,
            fallbackAssessment: fallback,
          }),
        },
      ],
      response_format: {
        type: "json_object",
      },
      max_tokens: 320,
      temperature: 0.2,
    });

    const aiText = getAiText(result);
    const parsed = parseAiJson(aiText);

    return {
      aiSummary: parsed.summary || fallback.aiSummary,
      abuseScore:
        normalizeAbuseScore(parsed.abuseScore) ||
        fallback.abuseScore,
      recommendation:
        parsed.recommendation || fallback.recommendation,
    };
  } catch (error) {
    console.error("Workers AI security analysis failed", error);
    return fallback;
  }
}

function buildHeuristicIntelligence(
  recentLogs: SecurityLogRow[],
  topAbusiveIps: TopAbusiveIpRow[]
): AttackIntelligence {
  const totalRequests = recentLogs.length;
  const blockedRequests = recentLogs.filter(
    (log) => !Boolean(log.allowed)
  ).length;
  const blockedRate =
    totalRequests > 0
      ? blockedRequests / totalRequests
      : 0;
  const highestTenantBlocked =
    topAbusiveIps[0]?.tenant_blocked_requests || 0;
  const crossTenantIp = topAbusiveIps.find(
    (ip) => ip.tenant_count > 1 && ip.blocked_requests > 0
  );
  const countries = new Set(
    recentLogs
      .map((log) => log.country)
      .filter((country): country is string => Boolean(country))
  );

  let abuseScore: AttackIntelligence["abuseScore"] = "Low";

  if (
    blockedRequests >= 30 ||
    highestTenantBlocked >= 20 ||
    (blockedRate >= 0.8 && totalRequests >= 10)
  ) {
    abuseScore = "Critical";
  } else if (
    blockedRequests >= 10 ||
    highestTenantBlocked >= 8 ||
    Boolean(crossTenantIp)
  ) {
    abuseScore = "High";
  } else if (
    blockedRequests >= 3 ||
    blockedRate >= 0.25 ||
    countries.size >= 4
  ) {
    abuseScore = "Medium";
  }

  const summaryParts = [
    `${blockedRequests} blocked requests observed across ${totalRequests} recent checks.`,
  ];

  if (topAbusiveIps[0]) {
    summaryParts.push(
      `Most active abusive IP is ${topAbusiveIps[0].ip_address} with ${topAbusiveIps[0].tenant_blocked_requests} blocked requests for this tenant.`
    );
  }

  if (crossTenantIp) {
    summaryParts.push(
      `${crossTenantIp.ip_address} appears across ${crossTenantIp.tenant_count} tenants.`
    );
  }

  if (countries.size >= 4) {
    summaryParts.push(
      `Traffic spans ${countries.size} countries, which may indicate unusual access.`
    );
  }

  return {
    aiSummary: summaryParts.join(" "),
    abuseScore,
    recommendation: getRecommendation(abuseScore),
  };
}

function getRecommendation(
  abuseScore: AttackIntelligence["abuseScore"]
) {
  switch (abuseScore) {
    case "Critical":
      return "Temporary 1-hour block suggested for the highest-risk IPs and immediate review recommended.";
    case "High":
      return "Temporary block or strict throttling suggested for repeated abusive IPs.";
    case "Medium":
      return "Increase monitoring and consider route-specific throttling if the pattern continues.";
    case "Low":
    default:
      return "Continue monitoring; no immediate mitigation required.";
  }
}

function getAiText(result: unknown) {
  if (typeof result === "string") {
    return result;
  }

  if (
    result &&
    typeof result === "object" &&
    "response" in result &&
    typeof result.response === "string"
  ) {
    return result.response;
  }

  return "";
}

function parseAiJson(text: string): {
  summary?: string;
  abuseScore?: string;
  recommendation?: string;
} {
  try {
    const parsed = JSON.parse(text) as AiJsonResponse;
    return {
      summary:
        typeof parsed.summary === "string"
          ? parsed.summary
          : undefined,
      abuseScore:
        typeof parsed.abuseScore === "string"
          ? parsed.abuseScore
          : undefined,
      recommendation:
        typeof parsed.recommendation === "string"
          ? parsed.recommendation
          : undefined,
    };
  } catch {
    return {
      summary: text || undefined,
    };
  }
}

function normalizeAbuseScore(
  value: string | undefined
): AttackIntelligence["abuseScore"] | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();

  if (normalized.includes("critical")) {
    return "Critical";
  }
  if (normalized.includes("high")) {
    return "High";
  }
  if (normalized.includes("medium")) {
    return "Medium";
  }
  if (normalized.includes("low")) {
    return "Low";
  }

  return undefined;
}
