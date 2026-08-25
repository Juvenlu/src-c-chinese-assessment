import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser } from '@/lib/auth-utils';

export const runtime = 'nodejs';

// 修改密码：需要当前密码验证
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const { oldPassword, newPassword } = body;
    const current_password = oldPassword;
    const new_password = newPassword;

    // 校验
    if (!current_password || !new_password) {
      return NextResponse.json({ error: '请填写当前密码和新密码' }, { status: 400 });
    }
    if (new_password.length < 8) {
      return NextResponse.json({ error: '新密码至少需要8位' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // 验证当前密码
    const { data: profile } = await supabase
      .from('parents_profiles')
      .select('password_hash')
      .eq('id', user.id)
      .single();

    if (!profile?.password_hash) {
      return NextResponse.json({ error: '账户未设置密码，请联系管理员' }, { status: 400 });
    }

    const valid = await bcrypt.compare(current_password, profile.password_hash);
    if (!valid) {
      return NextResponse.json({ error: '当前密码不正确' }, { status: 400 });
    }

    // 更新密码
    const newHash = bcrypt.hashSync(new_password, 10);
    const { error: updateError } = await supabase
      .from('parents_profiles')
      .update({ password_hash: newHash })
      .eq('id', user.id);

    if (updateError) {
      console.error('[ChangePassword] update error:', updateError);
      return NextResponse.json({ error: '密码修改失败，请稍后重试' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: '密码修改成功' });
  } catch (err: unknown) {
    console.error('[Change Password] error:', err);
    return NextResponse.json({ error: '修改失败，请稍后重试' }, { status: 500 });
  }
}
