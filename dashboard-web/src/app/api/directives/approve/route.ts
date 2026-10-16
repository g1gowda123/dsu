import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getArtifactPath } from '@/lib/artifacts';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const targetId = body.id || body.directive_id;

    if (!targetId || typeof targetId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Valid directive id or directive_id is required' },
        { status: 400 }
      );
    }

    const approvedBy = body.approvedBy || body.operator || 'Traffic_Operator_01';
    const approvedAt = new Date().toISOString();

    const directivesPath = getArtifactPath('directives.jsonl');
    let updatedDirective: any = null;

    if (directivesPath && fs.existsSync(directivesPath)) {
      const content = fs.readFileSync(directivesPath, 'utf-8');
      const lines = content.split('\n');
      const newLines: string[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          const itemId = item.id || item.directive_id;
          if (itemId === targetId) {
            item.status = 'approved';
            item.approved = true;
            item.approved_by = approvedBy;
            item.approved_at = approvedAt;
            updatedDirective = item;
          }
          newLines.push(JSON.stringify(item));
        } catch {
          newLines.push(line);
        }
      }

      // Write updated lines back to directives.jsonl
      fs.writeFileSync(directivesPath, newLines.join('\n') + '\n', 'utf-8');

      // Also append to append-only approval ledger
      const approvalsPath = path.resolve(path.dirname(directivesPath), 'approvals.jsonl');
      const approvalEntry = JSON.stringify({
        directive_id: targetId,
        status: 'approved',
        approved_by: approvedBy,
        approved_at: approvedAt,
        action: 'operator_sign_off',
      });
      fs.appendFileSync(approvalsPath, approvalEntry + '\n', 'utf-8');
    }

    return NextResponse.json({
      success: true,
      message: `Directive ${targetId} approved successfully`,
      directive: updatedDirective || {
        id: targetId,
        status: 'approved',
        approved: true,
        approved_by: approvedBy,
        approved_at: approvedAt,
      },
    });
  } catch (error) {
    console.error('Error approving directive:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
