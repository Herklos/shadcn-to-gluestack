# Shadcn to gluestack
For now it's only [tailwind](https://tailwindcss.com/) to [gluestack-ui](https://gluestack.io/) v2.

# Usage
## With [v0](https://v0.dev/)
### Project instructions
```
This website optimized for both mobile and web experience.

You are NOT ALLOWED to use any shadcn component.
Code it using tailwind ONLY.
```

### Setup
```
npm install -g jscodeshift
npm create gluestack@latest
```

### Convert
Download the tailwind / shadcn components into `src` directory.
```
jscodeshift -t shadcn-to-gluestack-all.js ./src --extensions=ts,tsx --parser=tsx
```

Add `lucide-react-native` to `package.json`
