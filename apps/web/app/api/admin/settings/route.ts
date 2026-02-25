import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isAdminEmail } from '@/lib/admin';
import { getAgentSettings, saveAgentSettings, type AgentSettingsInput } from '@/lib/agent-settings';

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

function toCleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseInput(body: unknown): AgentSettingsInput {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const modelsRaw =
    raw.models && typeof raw.models === 'object' ? (raw.models as Record<string, unknown>) : {};
  const promptsRaw =
    raw.prompts && typeof raw.prompts === 'object' ? (raw.prompts as Record<string, unknown>) : {};

  return {
    openrouterApiKey: toCleanString(raw.openrouterApiKey),
    openrouterBaseUrl: toCleanString(raw.openrouterBaseUrl),
    models: {
      summary: toCleanString(modelsRaw.summary),
      mindmap: toCleanString(modelsRaw.mindmap),
      infographic: toCleanString(modelsRaw.infographic),
      webpage: toCleanString(modelsRaw.webpage),
    },
    prompts: {
      summary: toCleanString(promptsRaw.summary),
      mindmap: toCleanString(promptsRaw.mindmap),
      infographic: toCleanString(promptsRaw.infographic),
      webpage: toCleanString(promptsRaw.webpage),
    },
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) return forbidden();

  const settings = await getAgentSettings();
  return NextResponse.json(settings);
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdminEmail(session?.user?.email)) return forbidden();

  const body = await request.json().catch(() => ({}));
  const input = parseInput(body);
  const settings = await saveAgentSettings(input);
  return NextResponse.json(settings);
}
