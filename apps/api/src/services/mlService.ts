/**
 * ML service client — the single, deliberate boundary between the Node API
 * and the Python ML service. All inference traffic goes through here so the
 * HTTP contract lives in exactly one place.
 *
 * The Python service itself does not exist yet; it will be implemented in a
 * later phase and expose e.g. POST /predict with an image payload.
 */
export interface InferenceResult {
  predictedClass: string;
  confidence: number;
  modelVersion: string;
}

const mlServiceUrl = process.env.ML_SERVICE_URL ?? "";

export async function predict(imagePath: string): Promise<InferenceResult> {
  if (!mlServiceUrl) throw new Error("ML_SERVICE_URL is not configured");

  const response = await fetch(`${mlServiceUrl}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagePath }),
  });

  if (!response.ok) {
    throw new Error(`ML service returned ${response.status}`);
  }
  return (await response.json()) as InferenceResult;
}
