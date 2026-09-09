import crypto from 'node:crypto';
import { hashPassword } from '../../api/_lib.js';
import { financeFixture } from './finance-acceptance-fixture.mjs';

export async function operatorFixture(db) {
  const one = async (sql, params=[]) => (await db.query(sql,params)).rows[0];
  const credentials = () => {
    const password = crypto.randomBytes(24).toString('base64url');
    return { password, ...hashPassword(password) };
  };
  const masterPassword=credentials();
  const master=await one(`insert into admin_users(full_name,username,role,password_salt,password_hash)
    values('QA master','qa.master','master_admin',$1,$2) returning id,username,role,session_version`,[masterPassword.salt,masterPassword.hash]);
  const users={master:{...master,password:masterPassword.password}};
  for (const [key,permissions] of [['a',['finance.read','finance.write','reports.read']],['b',['finance.read','finance.write','reports.read']]]) {
    const role=await one('select * from create_access_role_with_audit($1,$2,null,$3::text[])',[master.id,`QA operator ${key}`,permissions]);
    const password=credentials();
    const user=await one(`insert into admin_users(full_name,username,role,access_role_id,password_salt,password_hash)
      values($1,$2,'admin',$3,$4,$5) returning id,username,role,session_version`,[`QA operator ${key}`,`qa.operator.${key}`,role.id,password.salt,password.hash]);
    users[key]={...user,access_role_id:role.id,password:password.password};
  }
  const f=await financeFixture(db,{actor:master.id});
  return {f,users};
}
