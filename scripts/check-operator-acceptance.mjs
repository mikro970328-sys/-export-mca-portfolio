import { createOperatorAcceptanceDb } from './lib/operator-acceptance-db.mjs';
import { operatorFixture } from './lib/operator-acceptance-fixture.mjs';
import { checkOperatorConcurrency } from './lib/operator-acceptance-concurrency.mjs';
import { checkOperatorHttp } from './lib/operator-acceptance-http.mjs';

const db=await createOperatorAcceptanceDb();
let passed=0,failed=0;
const test=async(name,fn)=>{
  try{await fn();passed++;console.log(`PASS ${name}`);}
  catch(error){failed++;console.error(`FAIL ${name}: ${error.message}`);}
};
try {
  console.log(`Isolated PostgreSQL ${(await db.query('show server_version')).rows[0].server_version}; real concurrent connections and HTTP/PostgREST`);
  const {f,users}=await operatorFixture(db);
  const context={db,f,users,test};
  await checkOperatorConcurrency(context);
  await checkOperatorHttp(context);
  console.log(`Operator acceptance: ${passed} passed, ${failed} failed`);
  if(failed || passed!==22)process.exitCode=1;
}finally{await db.end();}
