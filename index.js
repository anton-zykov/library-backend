const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const mongoose = require('mongoose');
mongoose.set('strictQuery', false);
const Author = require('./models/Author');
const Book = require('./models/Book');
const { GraphQLError } = require('graphql');

require('dotenv').config();
const { MONGODB_URI } = process.env;

console.log('connecting to', MONGODB_URI);

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('connected to MongoDB');
  })
  .catch((error) => {
    console.log('error connection to MongoDB:', error.message);
  });

const typeDefs = `
  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]!
    id: ID!
  }

  type Author {
    name: String!
    born: Int
    bookCount: Int!
    id: ID!
  }

  type Query {
    bookCount: Int!
    authorCount: Int!
    allBooks(
      author: String
      genre: String
    ): [Book!]!
    allAuthors: [Author!]!
  }

  type Mutation {
    addBook(
      title: String!
      author: String!
      published: Int!
      genres: [String!]!
    ): Book!
    editAuthor(
      name: String!
      setBornTo: Int!
    ): Author
  }
`;

const resolvers = {
  Query: {
    bookCount: async () => Book.collection.countDocuments(),
    authorCount: async () => Author.collection.countDocuments(),
    allBooks: async (_, args) => {
      if (args.author && args.genre) {
        const author = await Author.findOne({ name: args.author });
        return Book.find({ author, genres: { $all: [args.genre] } }).populate('author');
      }

      if (args.author) {
        const author = await Author.findOne({ name: args.author });
        return Book.find({ author }).populate('author');
      }

      if (args.genre) {
        return Book.find({ genres: { $all: [args.genre] } }).populate('author');
      }

      return Book.find({}).populate('author');
    },
    allAuthors: async () => {
      const authors = await Author.find({});

      return authors.map(async (author) => {
        const books = await Book.find({ author });
        return { id: author.id, name: author.name, born: author.born, bookCount: books.length };
      });
    }
  },
  Mutation: {
    addBook: async (_, args) => {
      // Add author if this is his/her first book.
      let author = await Author.findOne({ name: args.author });
      if (!author) {
        if (args.author.length < 4) {
          throw new GraphQLError(
            'Author\'s name should be at least 4 characters long.',
            {
              extensions: {
                code: 'BAD_USER_INPUT',
                invalidArgs: args.name
              }
            }
          );
        }
        author = new Author({ name: args.author });
        await author.save();
      }

      if (args.title.length < 4) {
        throw new GraphQLError(
          'Book\'s title should be at least 4 characters long.',
          {
            extensions: {
              code: 'BAD_USER_INPUT',
              invalidArgs: args.title
            }
          }
        );
      }

      const book = new Book({ ...args, author });
      await book.save();
      return book.populate('author');
    },
    editAuthor: async (_, args) => {
      const author = await Author.findOne({ name: args.name });

      if (!author) {
        throw new GraphQLError(
          'The user does not exist.',
          {
            extensions: {
              code: 'BAD_USER_INPUT',
              invalidArgs: args.name
            }
          }
        );
      }

      author.born = args.setBornTo;
      return author.save();
    }
  }
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
});

startStandaloneServer(server, {
  listen: { port: 4000 },
}).then(({ url }) => {
  console.log(`Server ready at ${url}`);
});
