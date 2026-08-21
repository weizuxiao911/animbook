const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const Dotenv = require('dotenv-webpack');

module.exports = () => ({
  entry: path.resolve(__dirname, 'webapp/src/index.tsx'),
  output: {
    filename: '[name].[contenthash].js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/',
    clean: true,
  },
  cache: {
    type: 'filesystem',
    cacheDirectory: path.resolve(__dirname, '.webpack-cache'),
    // monaco-editor 等大依赖单独缓存, 避免每次 dev rebuild 都全量转译
    buildDependencies: {
      config: [__filename],
    },
  },
  watchOptions: {
    // 排除输出/缓存/运行期数据目录, 避免删除/重建目录时 watcher ENOENT 风暴杀掉 webpack
    ignored: [
      '**/node_modules/**',
      '**/.webpack-cache/**',
      '**/dist/**',
      '**/registry/dist/**',
      '**/registry/vsix/**',
      '**/assistant/workspace/**',
      '**/.playwright-screenshots/**',
      '**/.playwright-mcp/**',
    ],
    poll: false,
    aggregateTimeout: 200,
  },
  optimization: {
    // 把 monaco-editor 这种超大模块拆到独立 chunk, 避免单个 bundle 过大
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        monaco: {
          test: /[\\/]node_modules[\\/]@opensumi[\\/]monaco-editor-core[\\/]/,
          name: 'monaco-core',
          chunks: 'all',
          priority: 30,
        },
        opensumi: {
          test: /[\\/]node_modules[\\/]@opensumi[\\/]/,
          name: 'opensumi',
          chunks: 'all',
          priority: 20,
        },
        codeblitz: {
          test: /[\\/]node_modules[\\/]@codeblitzjs[\\/]/,
          name: 'codeblitz',
          chunks: 'all',
          priority: 25,
        },
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
          priority: 10,
        },
      },
    },
  },
  devtool: process.env.NODE_ENV === 'production' ? 'source-map' : 'eval-cheap-module-source-map',
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'webapp/src'),
      '@/': path.resolve(__dirname, 'webapp/src') + path.sep,
    },
    fallback: {
      path: require.resolve('path-browserify'),
      fs: false,
      crypto: false,
      stream: false,
      buffer: false,
      os: false,
      process: false,
    },
  },
  experiments: {
    asyncWebAssembly: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [{
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            experimentalWatchApi: true,
            // 启用 loader 缓存: 增量构建只重新编译改动文件, 避免 monaco-editor
            // 等大依赖在每次 webpack-dev-server 重建时被重新走一遍
            compilerOptions: { sourceMap: false },
          },
        }],
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.module\.less$/,
        use: [
          { loader: 'style-loader', options: { esModule: false } },
          {
            loader: 'css-loader',
            options: {
              importLoaders: 1,
              sourceMap: true,
              esModule: false,
              modules: { mode: 'local', localIdentName: '[local]___[hash:base64:5]' },
            },
          },
          { loader: 'less-loader', options: { lessOptions: { javascriptEnabled: true } } },
        ],
      },
      {
        test: /^((?!\.module).)*less$/,
        use: [
          { loader: 'style-loader', options: { esModule: false } },
          {
            loader: 'css-loader',
            options: { importLoaders: 1, sourceMap: true, esModule: false },
          },
          {
            loader: 'less-loader',
            options: {
              lessOptions: {
                javascriptEnabled: true,
                modifyVars: {
                  'kt-html-selector': 'alex-root',
                  'kt-body-selector': 'alex-root',
                },
              },
            },
          },
        ],
      },
      {
        test: /\.(woff2?|ttf|eot)(\?v=\d+\.\d+\.\d+)?$/,
        use: [
          {
            loader: 'file-loader',
            options: { name: '[name].[ext]', esModule: false, publicPath: './' },
          },
        ],
      },
      {
        test: /\.(png|jpe?g|gif|webp|ico|svg)(\?.*)?$/,
        use: [
          {
            loader: 'url-loader',
            options: {
              limit: 10000,
              name: '[name].[ext]',
              esModule: false,
              fallback: { loader: 'file-loader', options: { name: '[name].[ext]', esModule: false } },
            },
          },
        ],
      },
      {
        test: /\.(txt|text|md)$/,
        use: 'raw-loader',
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'webapp/src/index.html'),
      favicon: path.resolve(__dirname, 'webapp/src/assets/favicon.ico'),
    }),
    new Dotenv({
      path: path.resolve(__dirname, `.env.${process.env.DEPLOY_ENV || 'development'}`),
      safe: false,
      systemvars: true,
      silent: true,
    }),
    new webpack.DefinePlugin({
      'process.env.DEPLOY_ENV': JSON.stringify(process.env.DEPLOY_ENV || 'development'),
      'process.env.GATEWAY_URL': JSON.stringify(
        process.env.GATEWAY_URL || 'http://gateway.animbook.localhost'
      ),
      'process.env.REGISTRY_URL': JSON.stringify(
        process.env.REGISTRY_URL || 'http://registry.animbook.localhost'
      ),
      'process.env.RUNTIME_HOST_SUFFIX': JSON.stringify(
        process.env.RUNTIME_HOST_SUFFIX || 'runtime.animbook.localhost'
      ),
    }),
    new NodePolyfillPlugin({ includeAliases: ['process', 'Buffer'] }),
  ],
  devServer: {
    allowedHosts: 'all',
    host: '0.0.0.0',
    port: 8090,
    historyApiFallback: { disableDotRule: true },
    hot: true,
    client: {
      overlay: { errors: true, warnings: false, runtimeErrors: false },
    },
    proxy: [
      {
        context: ['/api'],
        target: 'http://127.0.0.1:24096',
        pathRewrite: { '^/api': '' },
        changeOrigin: true,
        ws: true,
      },
      {
        context: ['/extensions'],
        target: 'https://127.0.0.1:13000',
        pathRewrite: { '^/extensions': '' },
        changeOrigin: true,
        secure: false,
      },
    ],
  },
});
