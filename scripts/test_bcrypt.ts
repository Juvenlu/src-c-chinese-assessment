import bcrypt from 'bcryptjs';

const password = 'testpass123';
const hash = bcrypt.hashSync(password, 10);
console.log('hash:', hash, 'len:', hash.length);
console.log('compare:', bcrypt.compareSync(password, hash));
