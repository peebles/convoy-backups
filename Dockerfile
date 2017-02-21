FROM node:4
RUN apt-get update && \
    apt-get install -y cron && \
    rm -f /etc/cron.daily/* && \
    apt-get clean
COPY crontab /etc/crontab
ADD . /deploy
WORKDIR /deploy
CMD /etc/init.d/cron start; while true; do sleep 60; done
