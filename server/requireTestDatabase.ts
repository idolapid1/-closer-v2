if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required. PostgreSQL integration tests never use DATABASE_URL implicitly.');
}
