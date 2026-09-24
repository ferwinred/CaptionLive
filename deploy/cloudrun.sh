#!/usr/bin/env bash
# Deploy the CaptionLive backend to Google Cloud Run (pay-per-use, fits the event credits).
#
# Easiest: open https://shell.cloud.google.com (free, gcloud pre-installed) and run
#   git clone https://github.com/ferwinred/CaptionLive && cd CaptionLive
#   ./deploy/cloudrun.sh
#
# Optional env vars:
#   PROJECT       GCP project id                       (default: current gcloud project)
#   REGION        Cloud Run region                     (default: southamerica-east1 = São Paulo)
#   PAGES_URL     where the web app is hosted          (default: https://<owner>.github.io/CaptionLive)
#   EVENT_MODE=1  keep 1 instance warm (event day). 0 = scale to zero, ~free when idle.
#   GEMINI_API_KEY / CL_ADMIN_TOKEN   asked for / generated when missing
#   REDIS_URL     e.g. rediss://...upstash.io:6379 to persist sessions and allow >1 instance
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-southamerica-east1}"
SERVICE="${SERVICE:-captionlive}"
PAGES_URL="${PAGES_URL:-https://ferwinred.github.io/CaptionLive}"
EVENT_MODE="${EVENT_MODE:-0}"

if [[ -z "$PROJECT" ]]; then
  echo "No project selected. Run: gcloud config set project <PROJECT_ID>" >&2
  exit 1
fi
echo "==> Project: $PROJECT   Region: $REGION   Service: $SERVICE"
gcloud config set project "$PROJECT" >/dev/null

BILLING=$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || echo "")
if [[ "$BILLING" == "False" ]]; then
  echo "!! Billing is not enabled on $PROJECT. Link the billing account that holds your credits:"
  echo "   https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
  exit 1
fi

echo "==> Enabling APIs (first time takes ~1 min)"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com \
  generativelanguage.googleapis.com >/dev/null

# --- secrets --------------------------------------------------------------------------------
put_secret() {  # name value
  if gcloud secrets describe "$1" >/dev/null 2>&1; then
    printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=- >/dev/null
  else
    printf '%s' "$2" | gcloud secrets create "$1" --replication-policy=automatic --data-file=- >/dev/null
  fi
}
has_secret() { gcloud secrets versions access latest --secret="$1" >/dev/null 2>&1; }

if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  put_secret GEMINI_API_KEY "$GEMINI_API_KEY"
elif ! has_secret GEMINI_API_KEY; then
  echo "Create a Gemini API key in this project: https://aistudio.google.com/apikey"
  read -rsp "Paste GEMINI_API_KEY: " GEMINI_API_KEY; echo
  put_secret GEMINI_API_KEY "$GEMINI_API_KEY"
fi

NEW_TOKEN=""
if [[ -n "${CL_ADMIN_TOKEN:-}" ]]; then
  put_secret CL_ADMIN_TOKEN "$CL_ADMIN_TOKEN"
elif ! has_secret CL_ADMIN_TOKEN; then
  NEW_TOKEN=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)
  put_secret CL_ADMIN_TOKEN "$NEW_TOKEN"
fi

# Cloud Run + Cloud Build run as the default compute service account
NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="${NUMBER}-compute@developer.gserviceaccount.com"
for role in roles/secretmanager.secretAccessor roles/run.builder; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
    --role="$role" --condition=None >/dev/null 2>&1 || true
done

# --- deploy -----------------------------------------------------------------------------------
ENV="CL_SESSIONS_FILE=examples/sessions.yaml,CL_PUBLIC_URL=${PAGES_URL}"
MAX=1                                  # in-memory state: a single instance
if [[ -n "${REDIS_URL:-}" ]]; then
  ENV+=",CL_BROKER=redis,CL_REDIS_URL=${REDIS_URL}"
  MAX="${MAX_INSTANCES:-5}"
fi
MIN=0; [[ "$EVENT_MODE" == "1" ]] && MIN=1

echo "==> Building and deploying (3-5 min the first time)"
gcloud run deploy "$SERVICE" \
  --source . --region "$REGION" --allow-unauthenticated \
  --timeout 3600 --concurrency 1000 --cpu 1 --memory 512Mi \
  --min-instances "$MIN" --max-instances "$MAX" \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest,CL_ADMIN_TOKEN=CL_ADMIN_TOKEN:latest \
  --set-env-vars "$ENV" --quiet

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')
ENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1], safe=''))" "$URL")

cat <<EOF

✅ CaptionLive backend: $URL   (health: $URL/api/health)

  Audiencia (Pages):   ${PAGES_URL}/?api=${ENC}
  Panel de producción: ${PAGES_URL}/admin.html?api=${ENC}
  (o directo en el backend: $URL/  ·  $URL/admin)
EOF
if [[ -n "$NEW_TOKEN" ]]; then
  echo "  Admin token (guardalo): $NEW_TOKEN"
else
  echo "  Admin token: gcloud secrets versions access latest --secret=CL_ADMIN_TOKEN"
fi
cat <<EOF

  Tip: el día del evento  ->  EVENT_MODE=1 ./deploy/cloudrun.sh   (instancia siempre lista)
       después            ->  ./deploy/cloudrun.sh                 (escala a cero, ~US\$0)
EOF
