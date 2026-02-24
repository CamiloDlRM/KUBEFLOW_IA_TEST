#!/usr/bin/env bash
# test_pipeline.sh
#
# Simulates a GitHub push webhook to trigger a pipeline end-to-end.
# Usage:
#   GITHUB_WEBHOOK_SECRET=your_secret ./scripts/test_pipeline.sh
#
# Prerequisites:
#   - Backend running at http://localhost:8000
#   - At least one repository registered via POST /repos
#   - curl and openssl installed
set -euo pipefail

# ---- Configuration ----
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
WEBHOOK_SECRET="${GITHUB_WEBHOOK_SECRET:-changeme}"
REPO_URL="${TEST_REPO_URL:-https://github.com/user/test-repo}"
BRANCH="${TEST_BRANCH:-main}"
COMMIT_SHA="${TEST_COMMIT:-abc1234567890abcdef1234567890abcdef123456}"
POLL_INTERVAL=5
MAX_POLLS=60

echo "=== MLOps Pipeline Test ==="
echo "Backend:    ${BACKEND_URL}"
echo "Repo URL:   ${REPO_URL}"
echo "Branch:     ${BRANCH}"
echo "Commit SHA: ${COMMIT_SHA}"
echo ""

# ---- Build payload ----
PAYLOAD=$(cat <<EOF
{
  "ref": "refs/heads/${BRANCH}",
  "after": "${COMMIT_SHA}",
  "repository": {
    "html_url": "${REPO_URL}",
    "full_name": "user/test-repo"
  },
  "commits": [
    {
      "id": "${COMMIT_SHA}",
      "modified": ["notebooks/train.ipynb"],
      "added": [],
      "removed": []
    }
  ],
  "pusher": {
    "name": "test-user"
  }
}
EOF
)

# ---- Compute HMAC-SHA256 signature ----
SIGNATURE="sha256=$(echo -n "${PAYLOAD}" | openssl dgst -sha256 -hmac "${WEBHOOK_SECRET}" | awk '{print $NF}')"
echo "Computed signature: ${SIGNATURE}"
echo ""

# ---- Send webhook ----
echo ">>> Sending POST ${BACKEND_URL}/webhook/github"
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${BACKEND_URL}/webhook/github" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: ${SIGNATURE}" \
  -H "X-GitHub-Event: push" \
  -d "${PAYLOAD}")

HTTP_CODE=$(echo "${RESPONSE}" | tail -1)
BODY=$(echo "${RESPONSE}" | sed '$d')

echo "HTTP ${HTTP_CODE}"
echo "${BODY}"
echo ""

if [ "${HTTP_CODE}" != "202" ]; then
  echo "ERROR: Expected HTTP 202, got ${HTTP_CODE}"
  exit 1
fi

PIPELINE_ID=$(echo "${BODY}" | python3 -c "import sys,json; print(json.load(sys.stdin)['pipeline_id'])" 2>/dev/null || echo "")
if [ -z "${PIPELINE_ID}" ]; then
  echo "ERROR: Could not extract pipeline_id from response."
  exit 1
fi

echo "Pipeline ID: ${PIPELINE_ID}"
echo ""

# ---- Poll for completion ----
echo ">>> Polling pipeline status every ${POLL_INTERVAL}s (max ${MAX_POLLS} attempts)..."
for i in $(seq 1 ${MAX_POLLS}); do
  STATUS_RESPONSE=$(curl -s "${BACKEND_URL}/pipelines/${PIPELINE_ID}")
  STATUS=$(echo "${STATUS_RESPONSE}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unknown")

  echo "  [${i}/${MAX_POLLS}] status=${STATUS}"

  if [ "${STATUS}" = "success" ] || [ "${STATUS}" = "failed" ]; then
    echo ""
    echo "=== Pipeline Finished ==="
    echo "Status: ${STATUS}"
    echo ""
    echo "Full response:"
    echo "${STATUS_RESPONSE}" | python3 -m json.tool 2>/dev/null || echo "${STATUS_RESPONSE}"
    echo ""

    # Print metrics if available
    METRICS=$(echo "${STATUS_RESPONSE}" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('metrics',{}), indent=2))" 2>/dev/null || echo "{}")
    echo "Metrics:"
    echo "${METRICS}"

    if [ "${STATUS}" = "success" ]; then
      exit 0
    else
      exit 1
    fi
  fi

  sleep "${POLL_INTERVAL}"
done

echo "ERROR: Pipeline did not complete within $(( MAX_POLLS * POLL_INTERVAL )) seconds."
exit 1
