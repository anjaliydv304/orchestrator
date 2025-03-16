export default {
    transform: {}, 
    moduleNameMapper: {
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    testEnvironment: 'node',
    verbose: true,
    collectCoverage: true,
    coverageReporters: ['text', 'lcov'],
    coverageDirectory: 'coverage',
    testMatch: ['**/tests/**/*.test.js'],  
    moduleFileExtensions: ['js', 'json', 'node'],
  };