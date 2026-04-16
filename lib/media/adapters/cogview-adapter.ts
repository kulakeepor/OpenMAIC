/**
 * CogView (Zhipu AI / GLM) Image Generation Adapter
 *
 * Uses Zhipu AI's CogView image generation API.
 * Endpoint: https://open.bigmodel.cn/api/paas/v4/images/generations
 *
 * Supported models:
 * - cogview-3.0-async (async generation)
 * - cogview-3.0 (sync generation)
 * - cogview-3-plus (high quality)
 *
 * API docs: https://open.bigmodel.cn/dev/api#cogview
 */

import type {
  ImageGenerationConfig,
  ImageGenerationOptions,
  ImageGenerationResult,
} from '../types';

const DEFAULT_MODEL = 'cogview-4';
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

/**
 * Map aspect ratio to Zhipu size format.
 * Common sizes: 1024x1024, 1024x768, 768x1024, 1024x576
 */
function resolveZhipuSize(options: ImageGenerationOptions): { width: number; height: number } {
  const ratio = options.aspectRatio || '16:9';
  const maxWidth = options.width || 1024;

  const ratioMap: Record<string, [number, number]> = {
    '16:9': [maxWidth, Math.round(maxWidth * 9 / 16)],
    '4:3': [maxWidth, Math.round(maxWidth * 3 / 4)],
    '1:1': [maxWidth, maxWidth],
    '9:16': [maxWidth, Math.round(maxWidth * 16 / 9)],
  };

  const [w, h] = ratioMap[ratio] || ratioMap['16:9'];
  return { width: w, height: h };
}

/**
 * Lightweight connectivity test — validates API key by making a minimal request.
 * 401/403 means key invalid; other errors mean key is valid.
 */
export async function testCogviewConnectivity(
  config: ImageGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || DEFAULT_MODEL,
        prompt: 'test',
        size: '256x256',
      }),
    });
    if (response.status === 401 || response.status === 403) {
      const text = await response.text();
      return {
        success: false,
        message: `CogView auth failed (${response.status}): ${text}`,
      };
    }
    return { success: true, message: 'Connected to CogView' };
  } catch (err) {
    return { success: false, message: `CogView connectivity error: ${err}` };
  }
}

export async function generateWithCogview(
  config: ImageGenerationConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const { width, height } = resolveZhipuSize(options);

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || DEFAULT_MODEL,
      prompt: options.prompt,
      size: `${width}x${height}`,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`CogView generation failed (${response.status}): ${text}`);
  }

  const data = await response.json();

  // CogView response format:
  // { data: [ { url: "image_url" } ], created: timestamp }
  const images = data.data;
  if (!images || images.length === 0) {
    if (data.error) {
      throw new Error(`CogView error: ${data.error.message || JSON.stringify(data.error)}`);
    }
    throw new Error('CogView returned empty response');
  }

  const imageUrl = images[0]?.url;
  if (!imageUrl) {
    throw new Error('CogView response missing image URL');
  }

  return {
    url: imageUrl,
    width,
    height,
  };
}
