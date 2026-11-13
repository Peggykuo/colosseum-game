# Student agent: Add your own agent here
from agents.agent import Agent
from store import register_agent
import numpy as np
import time


@register_agent("student_agent")
class StudentAgent(Agent):
    """
    A dummy class for your implementation. Feel free to use this class to
    add any helper functionalities needed for your agent.
    """

    def __init__(self):
        super(StudentAgent, self).__init__()
        self.name = "StudentAgent"
        self.dir_map = {
            "u": 0,
            "r": 1,
            "d": 2,
            "l": 3,
        }
        self.autoplay = True

    def step(self, chess_board, my_pos, adv_pos, max_step):
        """
        Implement the step function of your agent here.
        You can use the following variables to access the chess board:
        - chess_board: a numpy array of shape (x_max, y_max, 4)
        - my_pos: a tuple of (x, y)
        - adv_pos: a tuple of (x, y)
        - max_step: an integer

        You should return a tuple of ((x, y), dir),
        where (x, y) is the next position of your agent and dir is the direction of the wall
        you want to put on.

        Please check the sample implementation in agents/random_agent.py or agents/human_agent.py for more details.
        """
        start_time = time.time()

        # Moves (Up, Right, Down, Left)
        moves = ((-1, 0), (0, 1), (1, 0), (0, -1))
        steps = np.random.randint(0, max_step + 1)

        # Pick steps random but allowable moves
        for _ in range(steps):
            r, c = my_pos

            # Build a list of the moves we can make
            allowed_dirs = [
                d
                for d in range(0, 4)
                if not chess_board[r, c, d]
                and not adv_pos == (r + moves[d][0], c + moves[d][1])
            ]

            if len(allowed_dirs) == 0:
                break

            random_dir = allowed_dirs[np.random.randint(0, len(allowed_dirs))]
            m_r, m_c = moves[random_dir]
            my_pos = (r + m_r, c + m_c)

        # Pick where to put our new barrier at random
        r, c = my_pos
        allowed_barriers = [i for i in range(0, 4) if not chess_board[r, c, i]]
        assert len(allowed_barriers) >= 1
        dir = allowed_barriers[np.random.randint(0, len(allowed_barriers))]

        time_taken = time.time() - start_time
        return my_pos, dir
