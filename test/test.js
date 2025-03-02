const { initORM } = require('../src');
const { getDB } = require('../src/db');

console.log('🔍 Initializing ORM...');
let userModel;

async function setup() {
  const orm = await initORM('./test/schema.orm');
  userModel = orm.model('user');
  postModel = orm.model('post');
}

async function runTests() {
  try {
    await setup();

    // Insert data
    const user = await userModel.create({name: "halo", email: "halo@gmail.com"}).then(() => console.log("Succes")).catch(e => console.error(e))
    console.log(user)
    // Fetch data
    console.log('Fetching all users...');
    const users = await userModel.findById(10);
    console.log('✅ Users:', users);
  
    const posts = await postModel.findAll();
    
    console.log('✅ Users:', posts)
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    console.log('Closing connection...');
    await getDB().destroy();
  }
}

runTests();