import { NextResponse } from 'next/server';
import { getAgentSettings } from '@/lib/agent-settings';

export async function GET() {
  try {
    const settings = await getAgentSettings();
    const formats = Array.isArray(settings.paperOutlineFormats)
      ? settings.paperOutlineFormats.filter((item) => typeof item === 'string' && item.trim())
      : [];
    return NextResponse.json({
      formats: formats.length > 0 ? formats : ['默认格式', '硕士学位论文', '本科毕业论文', '期刊'],
    });
  } catch {
    return NextResponse.json({
      formats: ['默认格式', '硕士学位论文', '本科毕业论文', '期刊'],
    });
  }
}
