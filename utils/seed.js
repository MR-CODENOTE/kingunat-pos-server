const supabase = require('./supabase');
const bcrypt = require('bcryptjs');

const defaultUsers = [
  { username: 'admin', password: 'password', role: 'admin' },
  { username: 'cashier', password: 'password', role: 'cashier' },
  { username: 'staff', password: 'password', role: 'staff' }
];

const checkAndSeedDefaultUsers = async () => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id')
      .limit(1);

    if (error) {
      console.error('Error checking for existing users:', error.message);
      return;
    }

    if (users.length === 0) {
      console.log('No users found. Seeding default users...');
      for (const user of defaultUsers) {
        const hashedPassword = await bcrypt.hash(user.password, 10);
        const { error: insertError } = await supabase
          .from('users')
          .insert({ username: user.username, password: hashedPassword, role: user.role });

        if (insertError) {
          console.error(`Error seeding user ${user.username}:`, insertError.message);
        }
      }
      console.log('Default users seeded successfully.');
    }
  } catch (err) {
    console.error('Unexpected error during user seeding:', err.message);
  }
};

module.exports = { checkAndSeedDefaultUsers };
