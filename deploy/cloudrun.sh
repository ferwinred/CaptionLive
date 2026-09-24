#!/usr/bin/env bash
# One-command deploy to Google Cloud Run (+ Memorystore Redis for >1 instance).
# Usage: PROJECT=my-project REGION=southamerica-east1 ./deploy/cloudrun.sh
set -euo pipefail
: "${PROJECT:?set PROJECT}"; REGION="${REGION:-southamerica-east1}"; SERVICE="${SERVICE:-captionlive}"

gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com

# Secrets (created once; re-running only adds a new version if you pass the env vars)
for name in GEMINI_API_KEY CL_ADMIN_TOKEN; do
  if ! gcloud secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "${!name:?export $name first}" | gcloud secrets create "$name" --data-file=-
  fi
done

EXTRA_ENV=""
if [[ -n "${REDIS_URL:-}" ]]; then   # e.g. redis://10.0.0.3:6379/0 (Memorystore + VPC connector)
  EXTRA_ENV=",CL_BROKER=redis,CL_REDIS_URL=${REDIS_URL}"
  MAX_INSTANCES="${MAX_INSTANCES:-10}"
else
  MAX_INSTANCES=1                    # memory broker = single instance
fi

gcloud run deploy "$SERVICE" \
  --source . --region "$REGION" --allow-unauthenticated \
  --timeout 3600 --concurrency 1000 --cpu 1 --memory 512Mi \
  --min-instances 1 --max-instances "$MAX_INSTANCES" --no-cpu-throttling \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest,CL_ADMIN_TOKEN=CL_ADMIN_TOKEN:latest \
  --set-env-vars "CL_SESSIONS_FILE=examples/sessions.yaml${EXTRA_ENV}" \
  ${VPC_CONNECTOR:+--vpc-connector "$VPC_CONNECTOR"}

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')
gcloud run services update "$SERVICE" --region "$REGION" --update-env-vars "CL_PUBLIC_URL=$URL"
echo "CaptionLive is live at $URL  (admin: $URL/admin)"
