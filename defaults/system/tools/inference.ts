/**
 * Provider-agnostic inference tool
 * @version 1.0.0
 *
 * Uses CLI tools that handle their own authentication:
 * 1. Claude CLI (claude -p) — if installed
 * 2. OpenCode CLI (opencode run) — if installed, handles local models too
 *
 * No API keys needed — CLIs manage auth. Install one and inference works.
 */

export interface InferenceOptions {
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
  timeout?: number;
  expectJson?: boolean;
}

export interface InferenceResult {
  success: boolean;
  text?: string;
  parsed?: unknown;
  error?: string;
  provider?: string;
}

// ---------------------------------------------------------------------------
// CLI Detection (cached)
// ---------------------------------------------------------------------------

let cliAvailability: { claude: boolean; opencode: boolean } | null = null;

async function detectCLIs(): Promise<{ claude: boolean; opencode: boolean }> {
  if (cliAvailability) return cliAvailability;

  const [claudeResult, opencodeResult] = await Promise.all([
    Bun.$`which claude`.quiet().nothrow(),
    Bun.$`which opencode`.quiet().nothrow(),
  ]);

  cliAvailability = {
    claude: claudeResult.exitCode === 0,
    opencode: opencodeResult.exitCode === 0,
  };

  return cliAvailability;
}

// ---------------------------------------------------------------------------
// CLI-Based Inference (preferred)
// ---------------------------------------------------------------------------

async function callClaudeCLI(
  options: InferenceOptions
): Promise<InferenceResult> {
  const prompt = options.systemPrompt
    ? `${options.systemPrompt}\n\n${options.userPrompt}`
    : options.userPrompt;

  const maxTokens = options.maxTokens || 256;
  const result = await Bun.$`claude -p ${prompt} --max-tokens ${maxTokens}`
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: `Claude CLI error: ${result.stderr.toString()}`,
      provider: "claude-cli",
    };
  }

  const text = result.stdout.toString().trim();
  return parseResponse(text, options.expectJson, "claude-cli");
}

async function callOpenCodeCLI(
  options: InferenceOptions
): Promise<InferenceResult> {
  const prompt = options.systemPrompt
    ? `${options.systemPrompt}\n\n${options.userPrompt}`
    : options.userPrompt;

  // opencode run expects prompt as argument
  const result = await Bun.$`opencode run ${prompt}`.quiet().nothrow();

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: `OpenCode CLI error: ${result.stderr.toString()}`,
      provider: "opencode-cli",
    };
  }

  const text = result.stdout.toString().trim();
  return parseResponse(text, options.expectJson, "opencode-cli");
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function parseResponse(
  text: string,
  expectJson?: boolean,
  provider?: string
): InferenceResult {
  if (!expectJson) {
    return { success: true, text, provider };
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { success: true, text, parsed, provider };
    } catch {
      return { success: true, text, provider };
    }
  }

  return { success: true, text, provider };
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Run inference using available CLI tools.
 *
 * Tries Claude CLI first, then OpenCode CLI.
 * Both handle their own authentication — no API keys needed.
 */
export async function inference(
  options: InferenceOptions
): Promise<InferenceResult> {
  const clis = await detectCLIs();

  if (clis.claude) {
    const result = await callClaudeCLI(options);
    if (result.success) return result;
  }

  if (clis.opencode) {
    const result = await callOpenCodeCLI(options);
    if (result.success) return result;
  }

  return {
    success: false,
    error: "No inference provider available. Install claude or opencode CLI.",
  };
}

/**
 * Check if any inference CLI is available.
 */
export async function hasInferenceProvider(): Promise<boolean> {
  const clis = await detectCLIs();
  return clis.claude || clis.opencode;
}
