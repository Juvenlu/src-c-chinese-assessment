import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, getSupabaseClient } from '@/lib/auth-utils';

/**
 * PATCH /api/children/[id]
 * 更新孩子资料
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const childId = (await params).id;
    const body = await req.json();

    const supabase = getSupabaseClient();

    // 验证归属
    const { data: child } = await supabase
      .from('children')
      .select('*')
      .eq('id', childId)
      .eq('parent_id', user.id)
      .maybeSingle();

    if (!child) {
      return NextResponse.json({ error: '孩子档案不存在' }, { status: 404 });
    }

    // 可更新字段
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.nickname !== undefined) updateData.nickname = body.nickname.trim();
    if (body.age !== undefined) {
      const age = parseInt(body.age, 10);
      if (!isNaN(age) && age >= 3 && age <= 18) updateData.age = age;
    }
    if (body.grade !== undefined) updateData.grade = body.grade.trim();
    if (body.country !== undefined) updateData.country = body.country.trim();
    if (body.home_language !== undefined) updateData.home_language = body.home_language;
    if (body.home_language_other !== undefined) updateData.home_language_other = body.home_language_other;

    const { data: updated, error } = await supabase
      .from('children')
      .update(updateData)
      .eq('id', childId)
      .select()
      .single();

    if (error) {
      console.error('[children PATCH] error:', error);
      return NextResponse.json({ error: '更新失败' }, { status: 500 });
    }

    return NextResponse.json({ success: true, child: updated });
  } catch (err) {
    console.error('[children PATCH] error:', err);
    return NextResponse.json({ error: '更新失败，请稍后重试' }, { status: 500 });
  }
}
