/**
 * Input validation middleware
 */

const { ValidationError } = require('../helper/error_handler');

/**
 * Validate page parameter (optional, defaults to 1)
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Express next function
 */
const validatePage = (req, res, next) => {
  const page = req.query.page;
  
  // Page is optional, default to 1
  if (page === undefined || page === null || page === '') {
    req.query.page = 1;
    return next();
  }
  
  const pageNum = parseInt(page);
  if (isNaN(pageNum) || pageNum < 1) {
    return res.status(400).json({
      status: 'error',
      code: 'VALIDATION_ERROR',
      message: 'page must be a positive integer',
      data: []
    });
  }
  
  req.query.page = pageNum;
  next();
};

/**
 * Validate keyword parameter
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Express next function
 */
const validateKeyword = (req, res, next) => {
  const keyword = req.query.keyword;
  
  if (!keyword || keyword.trim() === '') {
    return res.status(400).json({
      status: 'error',
      code: 'VALIDATION_ERROR',
      message: 'keyword parameter is required',
      data: []
    });
  }
  
  if (keyword.length < 2) {
    return res.status(400).json({
      status: 'error',
      code: 'VALIDATION_ERROR',
      message: 'keyword must be at least 2 characters',
      data: []
    });
  }
  
  next();
};

/**
 * Validate sort parameters
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Express next function
 */
const validateSort = (req, res, next) => {
  const sortBy = req.query.sortBy || 'title';
  const sortOrder = req.query.sortOrder || 'asc';
  
  const validSortFields = ['title', 'rating', 'date', 'released', 'author'];
  const validOrders = ['asc', 'desc'];
  
  if (!validSortFields.includes(sortBy)) {
    return res.status(400).json({
      status: 'error',
      code: 'VALIDATION_ERROR',
      message: `sortBy must be one of: ${validSortFields.join(', ')}`,
      data: []
    });
  }
  
  if (!validOrders.includes(sortOrder.toLowerCase())) {
    return res.status(400).json({
      status: 'error',
      code: 'VALIDATION_ERROR',
      message: 'sortOrder must be "asc" or "desc"',
      data: []
    });
  }
  
  req.query.sortBy = sortBy;
  req.query.sortOrder = sortOrder.toLowerCase();
  next();
};

module.exports = {
  validatePage,
  validateKeyword,
  validateSort
};

