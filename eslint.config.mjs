import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/explicit-function-return-type': ['warn', {
				allowExpressions: true,
				allowConciseArrowFunctionExpressionsStartingWithVoid: true,
			}],
			'no-console': ['warn', { allow: ['error'] }],
			'eqeqeq': ['error', 'always'],
			'prefer-const': 'error',
			'no-var': 'error',
		},
	},
	{
		files: ['src/services/AIDispatcher.ts'],
		rules: {
			'@typescript-eslint/no-require-imports': 'off',
		},
	},
	{
		files: ['tests/**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/explicit-function-return-type': 'off',
			'no-console': 'off',
		},
	},
	{
		ignores: ['main.js', 'node_modules/', '*.mjs'],
	},
);
