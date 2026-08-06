const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const Dotenv = require('dotenv-webpack');

module.exports = () => ({
  entry: path.resolve(__dirname, 'src/index.tsx'),
  output: {
    filename: '[name].[contenthash].js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/',
    clean: true,
  },
  devtool: 'inline-source-map',
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.json'],
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
        use: [{ loader: 'ts-loader', options: { transpileOnly: true } }],
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
      template: path.resolve(__dirname, 'src/index.html'),
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
        context: ['/ai'],
        target: 'http://127.0.0.1:24096',
        pathRewrite: { '^/ai': '' },
        changeOrigin: true,
        ws: true,
      },
    ],
  },
});
